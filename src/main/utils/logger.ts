import { EventEmitter } from 'events';

/**
 * 主进程统一日志器
 * 同时输出到 console，并通过 EventEmitter 推给主进程，由主进程转发到渲染进程
 */
class Logger extends EventEmitter {
  private write(level: 'info' | 'warn' | 'error', msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    this.emit('line', line);
  }

  info(msg: string): void {
    this.write('info', msg);
  }
  warn(msg: string): void {
    this.write('warn', msg);
  }
  error(msg: string): void {
    this.write('error', msg);
  }
}

export const logger = new Logger();
