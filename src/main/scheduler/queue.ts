import { EventEmitter } from "events";
import type { ProductItem, TaskState } from "../../shared/types";
import { runOneProduct } from "./runner";
import { configStore } from "../store/config";
import { logger } from "../utils/logger";
import { notifyAlert, notifyReport } from "../notify/webhook";
import { SerialQueue } from "../utils/serialQueue";

/**
 * 批量任务调度器
 * - 串行执行：拼多多风控严格，单账号串行最稳
 * - emit('update', state) 把每条任务的状态变更发给主进程
 */
class TaskScheduler extends EventEmitter {
  private queue = new SerialQueue();
  private running = false;
  private aborted = false;

  /** 启动批量任务 */
  async start(products: ProductItem[]): Promise<void> {
    if (this.running) {
      logger.warn("已有批量任务在执行，忽略重复 start");
      return;
    }
    this.running = true;
    this.aborted = false;
    const cfg = configStore.getAll();
    logger.info(`批量任务开始，总计 ${products.length} 个商品`);

    const summary = { success: 0, failed: 0, blocked: 0 };

    // 入队并等待全部完成
    await Promise.all(
      products.map((product) =>
        this.queue.add(async () => {
          if (this.aborted) return;
          const finalState = await runOneProduct(product, (s) =>
            this.emit("update", s),
          );
          if (finalState.status === "success") summary.success += 1;
          else if (finalState.status === "blocked") {
            summary.blocked += 1;
            await notifyAlert(
              `【${product.title}】被风控/验证码拦截，请人工处理`,
            );
          } else summary.failed += 1;

          // 商品间隔，规避风控
          if (!this.aborted) {
            await new Promise((r) => setTimeout(r, cfg.intervalMs));
          }
        }),
      ),
    );

    this.running = false;
    logger.info(
      `批量完成: 成功 ${summary.success} / 失败 ${summary.failed} / 阻塞 ${summary.blocked}`,
    );
    await notifyReport(summary, products.length);
  }

  /** 终止批量任务 */
  async stop(): Promise<void> {
    this.aborted = true;
    this.queue.clear();
    await this.queue.onIdle();
    this.running = false;
    logger.warn("批量任务已被用户中止");
  }
}

export const taskScheduler = new TaskScheduler();
