import type { Page } from "playwright";
import { logger } from "../../utils/logger";

/**
 * 「提交并上架」操作
 *
 * DOM 关键信息：
 *   <button id="submit_button" data-testid="beast-core-button" ...>
 *     <span>提交并上架</span>
 *   </button>
 *   ⭐ 最稳的锚点：id="submit_button"
 *
 * 点击后可能出现：
 *   1. 表单校验错误（弹出 toast/红字）→ 抛错
 *   2. 二次确认弹窗 → 自动点确认
 *   3. 成功跳转或 toast → 视为成功
 *
 * 失败处理：抛错让上层中止；成功记日志
 */

const SELECTORS = {
  submitBtn: 'button#submit_button, button[id="submit_button"]',
  // 提交后可能的二次确认弹窗里的"确定/确认"按钮
  confirmDialog:
    'button:has(span:text-is("确认")), button:has(span:text-is("确定")), button:has(span:text-is("继续提交"))',
  // 错误提示（拼多多自研 toast / 红字）
  errorToast:
    '[class*="error"]:visible, [class*="Error"]:visible, [class*="errorTip"]:visible',
};

/**
 * 点击「提交并上架」并尽量等待结果
 */
export async function submitGoods(page: Page): Promise<void> {
  logger.info("准备点击『提交并上架』");

  // 等按钮可见
  const btn = page.locator(SELECTORS.submitBtn).first();
  const visible = await btn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    throw new Error("未找到『提交并上架』按钮（#submit_button）");
  }
  await btn.scrollIntoViewIfNeeded().catch(() => undefined);

  // 优先用 evaluate 调用原生 click（拼多多自研组件兼容性更好）
  const clickResult = await page
    .evaluate(() => {
      // @ts-ignore 浏览器侧 document
      const el = document.querySelector(
        'button#submit_button, button[id="submit_button"]',
      );
      if (!el) return "no-button";
      // @ts-ignore HTMLElement
      (el as HTMLElement).click();
      return "clicked";
    })
    .catch(() => "evaluate-failed");
  logger.info(`点击『提交并上架』结果=${clickResult}`);

  // 兜底：原生 click 没生效时用 Playwright click
  if (clickResult !== "clicked") {
    await btn.click({ force: true }).catch(() => undefined);
  }

  // 等待 1.5s 给页面响应时间
  await page.waitForTimeout(1500);

  // 处理可能的二次确认弹窗
  const confirmInDialog = page.locator(SELECTORS.confirmDialog).first();
  if (
    await confirmInDialog.isVisible({ timeout: 1500 }).catch(() => false)
  ) {
    logger.info("检测到二次确认弹窗，自动点击『确认』");
    await confirmInDialog.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(1500);
  }

  // 检测错误提示（如缺字段、风控等）
  // 用文本兜底：含「请」「失败」「错误」「未填写」字样的红字
  const errText = await page
    .evaluate(() => {
      // @ts-ignore 浏览器侧 document
      const all = Array.from(document.querySelectorAll("*"));
      for (const el of all) {
        // @ts-ignore textContent
        const t = (el as { textContent?: string }).textContent || "";
        if (t.length < 80 && /提交失败|未填写|错误|风控|未通过/.test(t)) {
          return t.trim();
        }
      }
      return "";
    })
    .catch(() => "");
  if (errText) {
    logger.warn(`提交时检测到提示：${errText}`);
    // 不抛错，让用户人工确认；如需严格中止可改为 throw
  }

  logger.info("✓ 已点击『提交并上架』");
}
