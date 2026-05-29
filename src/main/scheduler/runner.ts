import type { ProductItem, TaskState } from '../../shared/types';
import { browserController } from '../browser/controller';
import { publishProduct } from '../browser/actions/publish';
import { checkLoginValid } from '../browser/actions/login';
import { logger } from '../utils/logger';
import { configStore } from '../store/config';

/**
 * 单商品执行器
 * 输入一条 ProductItem，执行完整上架流程并返回最终 TaskState
 */
export async function runOneProduct(
  product: ProductItem,
  onUpdate: (state: TaskState) => void,
): Promise<TaskState> {
  const cfg = configStore.getAll();

  const baseState: TaskState = {
    productId: product.id,
    title: product.title,
    status: 'running',
    attempts: 0,
    startedAt: Date.now(),
  };
  onUpdate(baseState);

  // 1. 校验登录态
  const page = await browserController.getPage();
  const loggedIn = await checkLoginValid(page);
  if (!loggedIn) {
    const failed: TaskState = {
      ...baseState,
      status: 'blocked',
      message: '登录态失效，请先登录',
      finishedAt: Date.now(),
    };
    onUpdate(failed);
    return failed;
  }

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    onUpdate({ ...baseState, status: attempt > 1 ? 'retrying' : 'running', attempts: attempt });
    try {
      const result = await publishProduct(page, product);
      if (result.success) {
        const ok: TaskState = {
          ...baseState,
          status: 'success',
          attempts: attempt,
          goodsId: result.goodsId,
          finishedAt: Date.now(),
          message: '上架成功',
        };
        onUpdate(ok);
        return ok;
      }
      lastError = result.message || '未知错误';
      logger.warn(`[${product.title}] 第 ${attempt} 次失败: ${lastError}`);
    } catch (err) {
      lastError = (err as Error).message;
      logger.error(`[${product.title}] 第 ${attempt} 次异常: ${lastError}`);
    }
    // 截图保留现场
    const screenshot = await browserController.screenshot(`fail-${product.id.slice(0, 20)}`);
    if (attempt < cfg.maxRetries) {
      // 随机退避 5~15s
      const wait = 5000 + Math.floor(Math.random() * 10_000);
      await new Promise((r) => setTimeout(r, wait));
    } else {
      const failed: TaskState = {
        ...baseState,
        status: 'failed',
        attempts: attempt,
        message: lastError,
        screenshotPath: screenshot,
        finishedAt: Date.now(),
      };
      onUpdate(failed);
      return failed;
    }
  }

  // 不应到达此处
  return {
    ...baseState,
    status: 'failed',
    message: lastError || '未知错误',
    finishedAt: Date.now(),
  };
}
