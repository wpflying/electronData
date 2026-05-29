import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { IPC_CHANNELS } from "../shared/types";
import type { AppConfig, CreateTaskParams, ProductItem } from "../shared/types";
import { configStore } from "./store/config";
import { parseExcel } from "./parser/excel";
import { browserController } from "./browser/controller";
import { taskScheduler } from "./scheduler/queue";
import { createTaskService } from "./scheduler/createTask";
import { parseProductExcel } from "./parser/productExcel";
import { logger } from "./utils/logger";

/**
 * Electron 主进程入口
 * 职责：
 * 1. 创建主窗口并加载渲染进程
 * 2. 注册 IPC handler（配置、登录、Excel、批量任务）
 * 3. 把任务调度器与日志事件转发给渲染进程
 */

// 在受限环境（如某些容器/沙箱）中禁用 Chromium sandbox，避免启动失败
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.disableHardwareAcceleration();

/**
 * 把 userData 重定位到项目目录下的 .userData/
 * 原因：在某些受限环境（macOS App Sandbox / Trae 沙箱等）下
 * ~/Library/Application Support/pdd-uploader 不可写，会导致：
 *  - 缓存目录创建失败的大量 ERROR 日志
 *  - electron-store 写 storageState 时 EPERM
 * 把数据放到 cwd 内最稳妥
 */
const customUserData = join(process.cwd(), ".userData");
if (!existsSync(customUserData)) mkdirSync(customUserData, { recursive: true });
app.setPath("userData", customUserData);
app.setPath("sessionData", customUserData);

let mainWindow: BrowserWindow | null = null;

const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
const isDev = !!rendererUrl;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "拼多多批量上架助手",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/** 注册 IPC 通道 */
function registerIpcHandlers(): void {
  // 配置读写
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, () => configStore.getAll());
  ipcMain.handle(IPC_CHANNELS.SET_CONFIG, (_e, patch: Partial<AppConfig>) => {
    return configStore.update(patch);
  });

  // 登录态相关
  ipcMain.handle(IPC_CHANNELS.LOGIN_PDD, async () => {
    return browserController.interactiveLogin();
  });
  ipcMain.handle(IPC_CHANNELS.IS_LOGGED_IN, async () => {
    return browserController.isLoggedIn();
  });

  // Excel 选择 + 解析
  ipcMain.handle(IPC_CHANNELS.PICK_EXCEL, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择商品 Excel 文件",
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle(IPC_CHANNELS.PARSE_EXCEL, async (_e, filePath: string) => {
    return parseExcel(filePath);
  });

  // 批量任务
  ipcMain.handle(
    IPC_CHANNELS.START_BATCH,
    async (_e, products: ProductItem[]) => {
      await taskScheduler.start(products);
    },
  );
  ipcMain.handle(IPC_CHANNELS.STOP_BATCH, async () => {
    await taskScheduler.stop();
  });

  // 商品 SKU Excel 选择 + 解析
  ipcMain.handle(IPC_CHANNELS.PICK_PRODUCT_EXCEL, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择商品 SKU Excel 文件",
      filters: [
        { name: "Excel", extensions: ["xlsx", "xls"] },
        { name: "全部文件", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
      const { rows, errors } = parseProductExcel(filePath);
      return { filePath, rows, errors };
    } catch (err) {
      logger.error(`解析商品 Excel 失败：${(err as Error).message}`);
      return {
        filePath,
        rows: [],
        errors: [{ rowIndex: -1, field: "file", message: (err as Error).message }],
      };
    }
  });

  // 创建任务
  ipcMain.handle(
    IPC_CHANNELS.START_CREATE,
    async (_e, params: CreateTaskParams) => {
      // 不 await，让前端通过 progress 事件感知进度
      void createTaskService.start(params);
    },
  );
  ipcMain.handle(IPC_CHANNELS.STOP_CREATE, async () => {
    await createTaskService.stop();
  });
}

/** 任务调度器与日志事件 -> 推送到渲染进程 */
function bridgeEventsToRenderer(): void {
  taskScheduler.on("update", (state) => {
    mainWindow?.webContents.send(IPC_CHANNELS.TASK_UPDATE, state);
  });
  createTaskService.on("progress", (state) => {
    mainWindow?.webContents.send(IPC_CHANNELS.CREATE_PROGRESS, state);
  });
  logger.on("line", (line) => {
    mainWindow?.webContents.send(IPC_CHANNELS.LOG, line);
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  bridgeEventsToRenderer();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", async () => {
  // 关闭 Playwright 浏览器，避免残留进程
  await browserController.dispose();
  if (process.platform !== "darwin") app.quit();
});
