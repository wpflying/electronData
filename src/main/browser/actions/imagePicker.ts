import type { Page, Locator } from "playwright";
import { logger } from "../../utils/logger";

/**
 * 「图片空间」弹窗交互：
 *   1. 在指定行点击预览图占位（小图标）
 *   2. 等待"图片空间"弹窗打开
 *   3. 在搜索输入框输入 imageFileName → 点「查询」
 *   4. 等待结果列表出现
 *   5. 点击第一张图（卡片）
 *   6. 点击「确认」按钮关闭弹窗
 *
 * 失败处理：搜不到结果时抛出错误，由调用方决定是否中止流程
 */

const SELECTORS = {
  /** 预览图占位单元格（td 里有个 svg 图标） */
  previewImageCell: "td:has(svg)",
  /**
   * 弹窗根（含「图片空间」标题）
   * 拼多多自研 MmsUiMaterialModal，没有标准 .ant-modal class
   * 用文本兜底定位
   */
  modal:
    'div:has(> div:has-text("图片空间")), [class*="MaterialModal"]:visible, [role="dialog"]:has-text("图片空间")',
  /**
   * 弹窗内的搜索输入框
   * placeholder="请输入图片名称"，data-testid="beast-core-input-htmlInput"
   */
  searchInput:
    'input[placeholder="请输入图片名称"][data-testid="beast-core-input-htmlInput"]',
  /**
   * 「查询」按钮（其实是 input suffix 内的 div，不是 button）
   * className 形如 MmsUiMaterialModalV3___searchSuffix___xxx
   */
  searchBtn:
    'div[class*="searchSuffix"]:has-text("查询"), [data-testid="beast-core-input-suffix"]:has-text("查询")',
  /** 结果区域空态文本 */
  emptyHint: ':text("暂无图片"), :text("无相关结果"), :text("没有找到")',
  /**
   * 弹窗内「确认」按钮：
   * - button[data-testid="beast-core-button"] 内含 <span>确认</span>
   * - 用 tracking id 进一步精确锁定（el_add_specification_drawing）
   */
  confirmBtn:
    'button[data-tracking-click-viewid="el_add_specification_drawing"], button[data-testid="beast-core-button"]:has(span:text-is("确认"))',
};

/**
 * 在指定 SKU 行打开图片空间弹窗
 * 通过点击行内"预览图"那一格里的小图标（通常是 svg/icon）
 *
 * 返回 page（直接在 page 上查找弹窗内元素，因为弹窗是 portal，DOM 上不一定在原 row 下）
 */
async function openImageModal(page: Page, row: Locator): Promise<void> {
  logger.info("点击预览图占位，打开图片空间弹窗");

  // 行内非 input 的可点击占位：优先 svg + 非状态开关的 td
  const placeholders = [
    row.locator("td .image-placeholder").first(),
    row
      .locator(
        'td:has(svg):not(:has(input)):not(:has(button)):not(:has([role="switch"]))',
      )
      .first(),
    row.locator("td svg").first(),
  ];
  let opened = false;
  for (const target of placeholders) {
    if ((await target.count()) === 0) continue;
    if (!(await target.isVisible().catch(() => false))) continue;
    await target.scrollIntoViewIfNeeded().catch(() => undefined);
    await target.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(700);
    // 用搜索 input 是否出现 作为弹窗已打开的可靠信号
    const inputVisible = await page
      .locator(SELECTORS.searchInput)
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    if (inputVisible) {
      opened = true;
      break;
    }
  }
  if (!opened) {
    throw new Error("点击预览图占位后未弹出图片空间弹窗（搜索输入框未出现）");
  }
}

/**
 * 在弹窗内搜索 + 选择第一张
 * 弹窗里这些元素的 placeholder/testid 在整个页面是唯一的，
 * 因此直接在 page 上 locator，避免 modal 容器定位失败导致的连锁失败
 *
 * @returns true 选中成功；false 没搜到结果
 */
async function searchAndPickFirst(
  page: Page,
  fileName: string,
): Promise<boolean> {
  // 1. 搜索 input
  const input = page.locator(SELECTORS.searchInput).first();
  await input.waitFor({ state: "visible", timeout: 8000 });
  await input.click({ force: true });
  await input.press("Meta+A").catch(() => undefined);
  await input.press("Backspace").catch(() => undefined);
  // 用 keyboard.type 模拟真实键入，确保 React onChange 触发
  await page.keyboard.type(fileName, { delay: 30 });
  logger.info(`图片空间搜索：${fileName}`);

  // 2. 点「查询」div（不是 button）
  const searchBtn = page.locator(SELECTORS.searchBtn).first();
  if (await searchBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await searchBtn.click({ force: true });
    logger.info("点击『查询』按钮");
  } else {
    logger.warn("未找到『查询』div 按钮，按 Enter 兜底");
    await input.press("Enter");
  }
  await page.waitForTimeout(1500);

  // 3. 检测空态
  const isEmpty = await page
    .locator(SELECTORS.emptyHint)
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (isEmpty) {
    logger.warn(`图片空间搜索『${fileName}』命中『暂无图片』空态`);
    return false;
  }

  // 4. 选中第一张图卡片
  //    经实测，在 Chromium console 里执行
  //      document.querySelectorAll('[data-testid="beast-core-card"]')[0].click()
  //    能让卡片选中（"已选 0 张" → "已选 1 张"）
  //    所以这里直接用 evaluate 调用第一个卡片的 .click() 即可
  //    （Playwright 的 locator.click 在 React 15 + 自研 beast-core 上不稳，故走原生 click）

  const confirmBtn = page.locator(SELECTORS.confirmBtn).first();
  const confirmVisible = await confirmBtn
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  logger.info(`「确认」按钮可见性=${confirmVisible}`);

  // 读取底部"已选 X 张"
  // 注：用 page.evaluate 避免 locator 隐式 30s 等待造成的阻塞
  async function readSelectedCount(): Promise<number> {
    const text = await page
      .evaluate(() => {
        // @ts-ignore 浏览器侧 document
        const all = Array.from(document.querySelectorAll("*"));
        for (const el of all) {
          const t = (el as { textContent?: string }).textContent || "";
          if (t.length < 50 && /已选\s*\d+\s*张/.test(t)) {
            return t;
          }
        }
        return "";
      })
      .catch(() => "");
    const m = text.match(/已选\s*(\d+)\s*张/);
    return m ? parseInt(m[1], 10) : -1;
  }

  // 等待结果卡片渲染（或空态）
  logger.info("等待图片空间搜索结果渲染...");
  const renderDeadline = Date.now() + 8000;
  while (Date.now() < renderDeadline) {
    const cardCount = await page
      .evaluate(
        () =>
          // @ts-ignore 浏览器侧 document
          document.querySelectorAll('[data-testid="beast-core-card"]').length,
      )
      .catch(() => 0);
    if (cardCount > 0) {
      logger.info(`✓ 结果卡片已渲染（${cardCount} 张）`);
      break;
    }
    const isEmptyNow = await page
      .locator(SELECTORS.emptyHint)
      .first()
      .isVisible({ timeout: 200 })
      .catch(() => false);
    if (isEmptyNow) {
      logger.warn(`图片空间搜索『${fileName}』命中『暂无图片』空态`);
      return false;
    }
    await page.waitForTimeout(200);
  }

  const before = await readSelectedCount();
  logger.info(`选图前 已选张数=${before}`);

  // ⭐ 主方案：直接调用第一个 [data-testid="beast-core-card"] 元素的原生 click()
  const clickResult = await page
    .evaluate(() => {
      // @ts-ignore 浏览器侧 document
      const cards = document.querySelectorAll('[data-testid="beast-core-card"]');
      if (cards.length === 0) return "no-cards-found";
      // @ts-ignore HTMLElement 浏览器侧
      const first = cards[0] as HTMLElement;
      try {
        first.click();
        return `clicked:total=${cards.length}`;
      } catch (e) {
        return `err:${(e as Error).message}`;
      }
    })
    .catch(() => "evaluate-failed");
  await page.waitForTimeout(500);
  let after = await readSelectedCount();
  logger.info(`原生 click() 结果=${clickResult} 已选=${after}`);

  // 兜底：如果原生 click 没生效，再尝试沿祖先链调用 React onClick
  if (after === before) {
    logger.warn("原生 click 未生效，尝试 React handler 直调兜底");
    const reactClicked = await page
      .evaluate(() => {
        // @ts-ignore 浏览器侧 document
        const cards = document.querySelectorAll('[data-testid="beast-core-card"]');
        if (cards.length === 0) return "no-cards-found";
        const el = cards[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function findHandlersOnSelfOrAncestor(node: any) {
          let cur = node;
          while (cur) {
            const key = Object.keys(cur).find(
              (k) =>
                k.startsWith("__reactEventHandlers") ||
                k.startsWith("__reactProps"),
            );
            if (key && cur[key] && typeof cur[key].onClick === "function") {
              return { node: cur, handlers: cur[key] };
            }
            cur = cur.parentElement;
          }
          return null;
        }
        const found = findHandlersOnSelfOrAncestor(el);
        if (!found) return "no-handler-found";
        // @ts-ignore 浏览器侧 MouseEvent
        const native = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        });
        const fakeEvent: Record<string, unknown> = {
          preventDefault: () => {},
          stopPropagation: () => {},
          isDefaultPrevented: () => false,
          isPropagationStopped: () => false,
          persist: () => {},
          currentTarget: found.node,
          target: el,
          type: "click",
          bubbles: true,
          cancelable: true,
          nativeEvent: native,
          dispatchConfig: {},
          _targetInst: null,
        };
        try {
          found.handlers.onClick(fakeEvent);
          return `ok`;
        } catch (e) {
          return `err:${(e as Error).message}`;
        }
      })
      .catch(() => "evaluate-failed");
    await page.waitForTimeout(500);
    after = await readSelectedCount();
    logger.info(`React handler 直调兜底 result=${reactClicked} 已选=${after}`);
  }

  if (after === before) {
    throw new Error(
      `无法选中第一张图（已选张数仍为 ${before}），请人工检查图片空间弹窗`,
    );
  }
  logger.info("✓ 已选中第一张图");
  await page.waitForTimeout(200);

  // 5. 点确认
  await confirmBtn.waitFor({ state: "visible", timeout: 5000 });
  // 等到按钮可点击（部分场景"未选图前确认按钮 disabled"）
  await page.waitForTimeout(200);
  await confirmBtn.click({ force: true });
  logger.info("已点击『确认』");

  // 6. 等弹窗消失（搜索 input 不再可见）作为成功标志
  await page
    .locator(SELECTORS.searchInput)
    .first()
    .waitFor({ state: "hidden", timeout: 8000 })
    .catch(() => undefined);
  return true;
}

/**
 * 主入口：为某行 SKU 选图
 * 失败（弹窗打不开 / 搜不到 / 找不到确认按钮）抛出错误，由调用方中止
 */
export async function pickImageForRow(
  page: Page,
  row: Locator,
  imageFileName: string,
): Promise<void> {
  if (!imageFileName?.trim()) {
    throw new Error("imageFileName 为空，无法在图片空间中搜索");
  }

  await openImageModal(page, row);
  const ok = await searchAndPickFirst(page, imageFileName.trim());
  if (!ok) {
    // 关闭弹窗：点「取消」（如果有）
    await page
      .locator('button:has-text("取消")')
      .first()
      .click({ force: true })
      .catch(() => undefined);
    throw new Error(`图片空间未搜到『${imageFileName}』，已停止流程`);
  }
}
