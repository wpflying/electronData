import type { Page } from 'playwright';
import { logger } from '../../utils/logger';

/**
 * 登录态校验：跳到商家后台首页，若被重定向到登录页则视为失效
 */
export async function checkLoginValid(page: Page): Promise<boolean> {
  try {
    await page.goto('https://mms.pinduoduo.com/home/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const url = page.url();
    if (url.includes('/login')) {
      logger.warn('检测到登录态已失效，需重新登录');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(`校验登录态出错: ${(err as Error).message}`);
    return false;
  }
}
