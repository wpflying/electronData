import type { IpcApi } from '../shared/types';

/** 给渲染进程使用的 window.api 类型声明 */
declare global {
  interface Window {
    api: IpcApi;
  }
}

export {};
