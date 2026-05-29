import { EventEmitter } from "events";
import type { CreateProgressState, CreateTaskParams } from "../../shared/types";
import { browserController } from "../browser/controller";
import { checkLoginValid } from "../browser/actions/login";
import { clickPublishSame } from "../browser/actions/opportunity";
import { setupCombinationSpecs } from "../browser/actions/specSetup";
import { fillPriceTable } from "../browser/actions/priceTable";
import type { Page } from "playwright";
import { logger } from "../utils/logger";

/**
 * 创建任务服务（按 Excel SKU 行执行）
 *
 * 当前阶段实现：
 *   1. 校验登录态
 *   2. 打开「搜索链接」（机会商品列表页）
 *   3. 点击第一个商品的「发布同款」并跳转，关闭弹窗
 *   4. 在「规格与库存」模块：
 *      - 删除已有规格类型
 *      - 添加新的「组合」规格
 *      - 把 Excel 里的每个 SKU 名逐行输入
 *   5. 这一阶段先不填库存/价格，留给用户人工核对
 *
 * 进度计数：
 *   - total = SKU 数（每个 SKU 输入名称视为一个任务）
 *   - 不再做 timesPerProduct 重复填表，因为本阶段每个 SKU 只需录入一行名称
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

    const { searchUrl, productRows } = params;
    const skus = productRows.map((r) => r.sku).filter(Boolean);
    const total = skus.length;

    const progress: CreateProgressState = {
      finished: 0,
      total,
      success: 0,
      failed: 0,
      blocked: 0,
      running: true,
    };
    this.emitProgress(progress);

    logger.info(`创建任务开始：搜索链接=${searchUrl} SKU 数=${skus.length}`);

    try {
      // 1. 校验登录态
      const { context, page } = await browserController.getContext();
      const loggedIn = await checkLoginValid(page);
      if (!loggedIn) {
        progress.running = false;
        progress.message = "登录态失效，请先登录";
        this.emitProgress(progress);
        this.running = false;
        return;
      }

      // 2. 打开搜索链接（机会商品列表页）
      if (!searchUrl) {
        progress.running = false;
        progress.message = "缺少搜索链接";
        this.emitProgress(progress);
        this.running = false;
        return;
      }
      progress.message = "正在打开搜索链接...";
      this.emitProgress(progress);
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      logger.info(`已打开搜索链接：${searchUrl}`);
      if (this.aborted) return this.finishWithMessage(progress, "已被用户中止");

      // 3. 点击「发布同款」+ 关闭弹窗
      progress.message = "点击『发布同款』并打开发布页...";
      this.emitProgress(progress);
      this.publishPage = await clickPublishSame(context, page, 0);
      if (this.aborted) return this.finishWithMessage(progress, "已被用户中止");

      // 等待发布页关键元素就绪：商品规格区块
      progress.message = "等待发布页加载...";
      this.emitProgress(progress);
      await this.publishPage
        .locator('text="商品规格"')
        .first()
        .waitFor({ state: "visible", timeout: 30_000 })
        .catch(() => {
          logger.warn("未检测到『商品规格』标题，仍尝试继续");
        });

      // 4. 设置「组合」规格 + 逐行输入 SKU
      progress.message = `设置规格类型『组合』并输入 ${skus.length} 个 SKU 名称...`;
      this.emitProgress(progress);
      await setupCombinationSpecs(this.publishPage, skus);

      // 5. 填写价格与库存表（点击空白触发表格渲染 → 逐行填充）
      if (this.aborted) return this.finishWithMessage(progress, "已被用户中止");
      progress.message = "填写价格与库存表...";
      this.emitProgress(progress);
      await fillPriceTable(this.publishPage, productRows);

      progress.success = skus.length;
      progress.finished = skus.length;
      progress.currentSku = skus[skus.length - 1];
      this.emitProgress(progress);

      progress.message =
        "规格 + 价格库存录入完成（请人工核对后点击『提交并上架』）";
    } catch (err) {
      logger.error(`创建任务异常：${(err as Error).message}`);
      progress.message = `异常：${(err as Error).message}`;
    }

    progress.running = false;
    progress.currentSku = undefined;
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
