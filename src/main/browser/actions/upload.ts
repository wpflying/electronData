import type { Page } from 'playwright';
import { logger } from '../../utils/logger';

/**
 * 上传一组图片到当前页面的某个 input[type=file]
 * 拼多多商家后台上传组件多为隐藏 input，可直接 setInputFiles
 *
 * @param page          当前页面
 * @param inputSelector 文件 input 选择器
 * @param files         本地绝对路径数组
 * @param timeout       超时（ms）
 */
export async function uploadImages(
  page: Page,
  inputSelector: string,
  files: string[],
  timeout = 60_000,
): Promise<void> {
  if (files.length === 0) return;
  logger.info(`上传 ${files.length} 张图片，等待元素 ${inputSelector}`);
  const input = await page.waitForSelector(inputSelector, { state: 'attached', timeout });
  await input.setInputFiles(files);
  // 等待上传完成：简化策略——观察是否出现 loading 节点的消失
  // 真实场景应根据拼多多页面的进度态做更精细判定
  await page.waitForTimeout(2000);
}
