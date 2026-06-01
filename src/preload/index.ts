import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/types";
import type {
  AppConfig,
  CreateProgressState,
  CreateTaskParams,
  IpcApi,
  ProductItem,
  TaskState,
  ParseResult,
} from "../shared/types";

/**
 * Preload 脚本：在渲染进程暴露受控 IPC API
 * 只允许预定义通道通信，避免渲染进程直接拿到 ipcRenderer
 */

const api: IpcApi = {
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),
  setConfig: (cfg: Partial<AppConfig>) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_CONFIG, cfg),

  loginPdd: () => ipcRenderer.invoke(IPC_CHANNELS.LOGIN_PDD),
  isLoggedIn: () => ipcRenderer.invoke(IPC_CHANNELS.IS_LOGGED_IN),
  fetchUserName: () => ipcRenderer.invoke(IPC_CHANNELS.FETCH_USER_NAME),

  pickExcel: () => ipcRenderer.invoke(IPC_CHANNELS.PICK_EXCEL),
  parseExcel: (filePath: string): Promise<ParseResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.PARSE_EXCEL, filePath),

  startBatch: (products: ProductItem[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.START_BATCH, products),
  stopBatch: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_BATCH),

  // 商品 SKU Excel + 创建任务
  pickProductExcel: () => ipcRenderer.invoke(IPC_CHANNELS.PICK_PRODUCT_EXCEL),
  startCreate: (params: CreateTaskParams) =>
    ipcRenderer.invoke(IPC_CHANNELS.START_CREATE, params),
  stopCreate: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_CREATE),
  retryCreate: (params: CreateTaskParams) =>
    ipcRenderer.invoke(IPC_CHANNELS.RETRY_CREATE, params),

  onTaskUpdate: (cb) => {
    const handler = (_e: unknown, state: TaskState) => cb(state);
    ipcRenderer.on(IPC_CHANNELS.TASK_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_UPDATE, handler);
  },
  onLog: (cb) => {
    const handler = (_e: unknown, line: string) => cb(line);
    ipcRenderer.on(IPC_CHANNELS.LOG, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.LOG, handler);
  },
  onCreateProgress: (cb) => {
    const handler = (_e: unknown, state: CreateProgressState) => cb(state);
    ipcRenderer.on(IPC_CHANNELS.CREATE_PROGRESS, handler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.CREATE_PROGRESS, handler);
  },
};

contextBridge.exposeInMainWorld("api", api);
