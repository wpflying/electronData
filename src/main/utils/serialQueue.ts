/**
 * 极简串行队列
 * - 仅支持 concurrency=1 的串行执行
 * - 提供 add / clear / onIdle / size / pending 等核心 API
 * - 自实现以彻底规避 p-queue ESM-only 与 Electron CJS 主进程的互操作问题
 */
export class SerialQueue {
  private tasks: Array<() => Promise<void>> = [];
  private isRunning = false;
  private idleResolvers: Array<() => void> = [];

  /** 入队，并返回该任务的 Promise */
  add<T>(taskFn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrapped = async () => {
        try {
          const result = await taskFn();
          resolve(result);
        } catch (err) {
          reject(err as Error);
        }
      };
      this.tasks.push(wrapped);
      void this.run();
    });
  }

  /** 清空尚未执行的任务（不会终止当前正在执行的任务） */
  clear(): void {
    this.tasks = [];
  }

  /** 等待队列空闲（当前任务执行完且无待处理任务） */
  onIdle(): Promise<void> {
    if (!this.isRunning && this.tasks.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  get size(): number {
    return this.tasks.length;
  }

  get pending(): number {
    return this.isRunning ? 1 : 0;
  }

  private async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    while (this.tasks.length > 0) {
      const task = this.tasks.shift()!;
      try {
        await task();
      } catch {
        // 单个任务内部异常已通过 add 的 reject 抛给调用方，此处吞掉避免中断队列
      }
    }
    this.isRunning = false;
    // 触发所有 onIdle 等待者
    const resolvers = this.idleResolvers.splice(0);
    resolvers.forEach((r) => r());
  }
}
