import { EventEmitter } from "events";
import type { CreateProgressState, CreateTaskParams } from "../../shared/types";
import { browserController } from "../browser/controller";
import { checkLoginValid } from "../browser/actions/login";
import { clickPublishSame } from "../browser/actions/opportunity";
import {
  setupSpecTypeOnly,
  addSingleSkuValue,
} from "../browser/actions/specSetup";
import {
  waitPriceTableReady,
  fillSingleRow,
} from "../browser/actions/priceTable";
import { submitGoods } from "../browser/actions/submit";
import type { Page } from "playwright";
import { logger } from "../utils/logger";

/**
 * 创建任务服务（按 Excel SKU 行执行）
 *
 * 流程语义：
 *   timesPerProduct = N → 整个流程（发布同款 → 设置规格 → 逐行填 SKU+价格库存 → 提交）
 *                       重复执行 N 次，每次产出一个商品。
 *
 * 单次流程（逐行）：
 *   1. 打开搜索链接（机会商品列表）
 *   2. 点击第一个商品『发布同款』，跳转到发布页，关闭弹窗
 *   3. 删除已有规格 + 添加规格类型『组合』
 *   4. 触发价格库存表渲染（点空白处使输入框失焦）
 *   5. 对每一行 ProductRow：
 *        a. 在「请输入规格名称」输入这行 SKU 名 + Enter
 *        b. 找到该 SKU 对应的表格行，填库存/拼单价/单买价/规格编码 + 选预览图
 *        c. 完成后回到规格输入框，处理下一行
 *   6. 点击『提交并上架』（如 autoSubmit=true）
 */

class CreateTaskService extends EventEmitter {
  private aborted = false;
  private running = false;
  /** 当前发布页（同款跳转后的目标 page） */
  private publishPage: Page | null = null;

  isRunning(): boolean {
    return this.running;
  }

  async start(params: CreateTaskParams): Promise<void> {
    if (this.running) {
      logger.warn("已有创建任务在执行，忽略重复 start");
      return;
    }
    this.running = true;
    this.aborted = false;
    this.publishPage = null;

    const { searchUrl, productRows, timesPerProduct = 1 } = params;
    // 第几个商品（UI 1-based → 内部 0-based）
    const productIndex0 = Math.max(0, (params.productIndex ?? 1) - 1);
    const skus = productRows.map((r) => r.sku).filter(Boolean);
    const total = Math.max(1, timesPerProduct);

    const progress: CreateProgressState = {
      finished: 0,
      total,
      success: 0,
      failed: 0,
      blocked: 0,
      running: true,
    };
    this.emitProgress(progress);

    logger.info(
      `创建任务开始：搜索链接=${searchUrl} 第${productIndex0 + 1}个商品 SKU 数=${skus.length} 重复=${total} 次 autoSubmit=${!!params.autoSubmit}`,
    );

    // 1. 校验登录态（只校验一次）
    const { context, page } = await browserController.getContext();
    const loggedIn = await checkLoginValid(page);
    if (!loggedIn) {
      progress.running = false;
      progress.message = "登录态失效，请先登录";
      this.emitProgress(progress);
      this.running = false;
      return;
    }
    if (!searchUrl) {
      progress.running = false;
      progress.message = "缺少搜索链接";
      this.emitProgress(progress);
      this.running = false;
      return;
    }

    // 2. 外层循环：整个流程重复 total 次
    for (let round = 1; round <= total; round++) {
      if (this.aborted) {
        progress.message = "已被用户中止";
        break;
      }
      logger.info(`============ 第 ${round}/${total} 轮开始 ============`);
      progress.currentSku = `第 ${round}/${total} 轮`;
      progress.message = `第 ${round}/${total} 轮：打开搜索链接...`;
      this.emitProgress(progress);

      try {
        // 2.1 打开搜索链接（每轮都打开，避免上一轮提交后页面状态污染）
        await page.goto(searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.bringToFront().catch(() => undefined);

        // 2.2 点「发布同款」+ 关闭弹窗
        progress.message = `第 ${round}/${total} 轮：点击第 ${productIndex0 + 1} 个商品『发布同款』...`;
        this.emitProgress(progress);
        this.publishPage = await clickPublishSame(context, page, productIndex0);

        // 2.3 等发布页加载
        await this.publishPage
          .locator('text="商品规格"')
          .first()
          .waitFor({ state: "visible", timeout: 30_000 })
          .catch(() => {
            logger.warn("未检测到『商品规格』标题，仍尝试继续");
          });

        // 2.4 规格类型前置（删除已有 + 添加『组合』）
        progress.message = `第 ${round}/${total} 轮：设置规格类型『组合』...`;
        this.emitProgress(progress);
        await setupSpecTypeOnly(this.publishPage);

        // 2.5 触发价格库存表渲染（点空白处失焦）
        //     注意：此时表格已存在但还没行；逐行流程里每输入一个 SKU 会新增一行
        progress.message = `第 ${round}/${total} 轮：等待价格库存表就绪...`;
        this.emitProgress(progress);
        await waitPriceTableReady(this.publishPage);

        // 2.6 逐行循环：输入 SKU 名 → 填该行价格库存 → 下一行
        for (let i = 0; i < productRows.length; i++) {
          if (this.aborted) break;
          const row = productRows[i];
          progress.currentSku = `第 ${round}/${total} 轮 · 行 ${i + 1}/${productRows.length}`;
          progress.message = `输入规格名 [${i + 1}/${productRows.length}]：${row.sku}`;
          this.emitProgress(progress);

          // (a) 输入这一行 SKU 名（placeholder="请输入规格名称"）
          await addSingleSkuValue(this.publishPage, row.sku);

          // (b) 填这一行的库存 / 拼单价 / 单买价 / 规格编码 + 选预览图
          //     传 rowIndex=i：按"表格第 i 行"定位（不依赖 SKU 文本匹配，更稳）
          progress.message = `填写第 ${i + 1}/${productRows.length} 行价格库存：${row.sku}`;
          this.emitProgress(progress);
          await fillSingleRow(this.publishPage, row, i);
        }

        // 2.7 提交（如开启）
        if (params.autoSubmit) {
          progress.message = `第 ${round}/${total} 轮：点击『提交并上架』...`;
          this.emitProgress(progress);
          await submitGoods(this.publishPage);
        }

        progress.success += 1;
        logger.info(`✓ 第 ${round}/${total} 轮完成`);
      } catch (err) {
        progress.failed += 1;
        logger.error(
          `✗ 第 ${round}/${total} 轮失败: ${(err as Error).message}`,
        );
        progress.message = `第 ${round}/${total} 轮失败：${(err as Error).message}`;
      } finally {
        progress.finished += 1;
        this.emitProgress(progress);
        // 轮间隔，规避风控
        if (round < total && !this.aborted) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    progress.running = false;
    progress.currentSku = undefined;
    if (!this.aborted) {
      progress.message = `全部完成：成功 ${progress.success} / 失败 ${progress.failed}`;
    }
    this.emitProgress(progress);
    logger.info(
      `创建任务结束：成功 ${progress.success} / 失败 ${progress.failed} / 阻塞 ${progress.blocked}`,
    );
    this.running = false;
  }

  async stop(): Promise<void> {
    this.aborted = true;
    this.running = false;
    logger.warn("创建任务已被用户中止");
  }

  /**
   * 调试用「重试规格」：
   *   - 复用当前已打开的发布页（不再点发布同款）
   *   - 仅执行：删除已有规格 → 添加「组合」 → 输入 SKU 名称
   *   - 不会走价格库存表填充
   *
   * 用途：当上一轮规格输入失败/不完整时，无需从头开始整个流程，
   *      只重跑规格设置那一段做调试
   */
  async retrySpecs(params: CreateTaskParams): Promise<void> {
    if (this.running) {
      logger.warn("当前正在执行任务，忽略重试请求");
      return;
    }
    this.running = true;
    this.aborted = false;

    const { productRows } = params;
    const skus = productRows.map((r) => r.sku).filter(Boolean);
    const total = skus.length;

    const progress: CreateProgressState = {
      finished: 0,
      total,
      success: 0,
      failed: 0,
      blocked: 0,
      running: true,
      message: "[重试] 开始重新设置规格...",
    };
    this.emitProgress(progress);

    try {
      // 1. 找一个可用的发布页：优先复用上次的 publishPage；否则取当前 context 的 page
      let page = this.publishPage;
      if (!page || page.isClosed()) {
        const ctx = await browserController.getContext();
        // 在所有 page 里找标题/URL 含发布相关的那一个
        const allPages = ctx.context.pages();
        page =
          allPages.find((p) => /goods_add|goods_edit/.test(p.url())) ||
          ctx.page;
        this.publishPage = page;
        logger.info(`[重试] 复用 page: ${page.url()}`);
      } else {
        logger.info(`[重试] 复用已有 publishPage: ${page.url()}`);
      }

      // 2. 把页面拉到最前
      await page.bringToFront().catch(() => undefined);

      // 3. 等「商品规格」区块就绪
      await page
        .locator(':text("商品规格")')
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => {
          logger.warn("[重试] 未检测到『商品规格』区块，仍尝试继续");
        });

      // 4. 重新跑规格类型前置 + 逐行输入 SKU 名
      progress.message = `[重试] 删除已有规格 + 添加『组合』 + 逐行输入 ${skus.length} 个 SKU...`;
      this.emitProgress(progress);
      await setupSpecTypeOnly(page);
      for (const sku of skus) {
        await addSingleSkuValue(page, sku);
      }

      progress.success = skus.length;
      progress.finished = skus.length;
      progress.currentSku = skus[skus.length - 1];
      progress.message = "[重试] 规格设置完成";
      this.emitProgress(progress);
    } catch (err) {
      logger.error(`[重试] 异常：${(err as Error).message}`);
      progress.message = `[重试] 异常：${(err as Error).message}`;
    }

    progress.running = false;
    this.emitProgress(progress);
    this.running = false;
  }

  private finishWithMessage(
    progress: CreateProgressState,
    message: string,
  ): void {
    progress.running = false;
    progress.message = message;
    this.emitProgress(progress);
    this.running = false;
  }

  private emitProgress(state: CreateProgressState): void {
    this.emit("progress", { ...state });
  }
}

export const createTaskService = new CreateTaskService();
