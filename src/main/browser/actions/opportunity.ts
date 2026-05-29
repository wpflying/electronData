import type { BrowserContext, Page } from "playwright";
import { logger } from "../../utils/logger";

/**
 * 机会商品列表页 → 点击第一个商品的「发布同款」 → 跳到「发布新商品」页 → 关闭弹窗
 *
 * 兼容点击后行为：
 *  - 同 tab 跳转：直接监听当前 page 的 URL 变化
 *  - 新 tab 打开：监听 context 的 'page' 事件，返回新页面
 *
 * 返回值：发布页对应的 Page（后续填表用）
 */

const SELECTORS = {
  /**
   * 「发布同款」按钮：
   * - 拼多多机会商品卡片下方的 button/span 文本
   * - 用文本兜底，最稳；同时只取第一个商品（first()）
   */
  publishSameBtn: ":text-is('发布同款'), button:has-text('发布同款'), a:has-text('发布同款')',",
  /** 「机会商品发布提示」弹窗的「知道了」按钮 */
  dialogOkBtn: 'button:has-text("知道了"), button:has-text("我知道了")',
  /** 弹窗右上角关闭 × */
  dialogCloseBtn: '.ant-modal-close, [aria-label="Close"], .anticon-close',
  /** 发布新商品页的标题，用于校验已落地 */
  publishPageTitle: ':text("发布新商品")',
};

/**
 * 关闭"机会商品发布提示"弹窗
 * 优先点「知道了」，找不到则点 ×。失败也不阻断后续流程。
 */
export async function closePublishDialog(page: Page): Promise<void> {
  // 短等待让弹窗有机会出现
  await page.waitForTimeout(800);
  const ok = page.locator(SELECTORS.dialogOkBtn).first();
  if (await ok.isVisible().catch(() => false)) {
    logger.info("关闭弹窗：点击『知道了』");
    await ok.click().catch(() => undefined);
    await page.waitForTimeout(300);
    return;
  }
  const closeX = page.locator(SELECTORS.dialogCloseBtn).first();
  if (await closeX.isVisible().catch(() => false)) {
    logger.info("关闭弹窗：点击 ×");
    await closeX.click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

/**
 * 在机会商品列表页点击「发布同款」并返回发布页 Page
 *
 * @param context Playwright BrowserContext
 * @param listPage 当前在机会商品列表页的 Page
 * @param productIndex 取第几个商品的发布同款（0 = 第一个）
 */
export async function clickPublishSame(
  context: BrowserContext,
  listPage: Page,
  productIndex = 0,
): Promise<Page> {
  // 等待列表渲染
  await listPage.waitForLoadState("domcontentloaded");
  await listPage
    .waitForSelector('button:has-text("发布同款"), a:has-text("发布同款")', {
      state: "visible",
      timeout: 30_000,
    })
    .catch(() => undefined);

  const buttons = listPage.locator(
    'button:has-text("发布同款"), a:has-text("发布同款")',
  );
  const count = await buttons.count();
  if (count === 0) {
    throw new Error("未在列表页找到「发布同款」按钮，请确认搜索链接是否为机会商品列表页");
  }
  const target = buttons.nth(Math.min(productIndex, count - 1));
  // 滚动到可见
  await target.scrollIntoViewIfNeeded().catch(() => undefined);

  // 监听新 tab：很多情况下「发布同款」是 target=_blank
  const popupPromise = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);

  logger.info(`点击第 ${productIndex + 1} 个商品的「发布同款」`);
  await target.click();

  // 优先等新 tab；没有则用当前 page
  const newPage = await popupPromise;
  let publishPage: Page;
  if (newPage) {
    publishPage = newPage;
    logger.info("发布同款在新 tab 打开");
  } else {
    publishPage = listPage;
    logger.info("发布同款在当前 tab 跳转");
  }

  // 等待发布页就绪
  await publishPage.waitForLoadState("domcontentloaded");
  await publishPage
    .waitForSelector(SELECTORS.publishPageTitle, { timeout: 30_000 })
    .catch(() => {
      logger.warn("未检测到「发布新商品」标题，继续尝试关闭弹窗");
    });

  // 关闭弹窗
  await closePublishDialog(publishPage);

  return publishPage;
}
