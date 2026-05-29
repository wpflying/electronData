import Store from "electron-store";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import type { AppConfig } from "../../shared/types";

/**
 * 本地配置存储封装
 * 基于 electron-store，存储路径强制写到项目目录下的 .userData/，
 * 避免 macOS Sandbox / Trae 沙箱下默认的 ~/Library/Application Support 不可写问题。
 */

const DEFAULT_CONFIG: AppConfig = {
  webhookUrl: "",
  maxRetries: 3,
  intervalMs: 8000,
  headless: false,
};

interface SchemaShape {
  config: AppConfig;
  /** Playwright storageState（登录态）JSON 字符串 */
  storageState: string;
}

/**
 * 获取项目内可写的存储目录
 * 注意：不能依赖 Electron 的 app.getPath('userData')，
 *      因为 electron-store 在模块 import 期就实例化，可能早于 app.setPath 调用。
 */
function getStoreCwd(): string {
  const dir = join(process.cwd(), ".userData");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const store = new Store<SchemaShape>({
  name: "pdd-uploader-config",
  cwd: getStoreCwd(),
  defaults: {
    config: DEFAULT_CONFIG,
    storageState: "",
  },
});

export const configStore = {
  getAll(): AppConfig {
    return { ...DEFAULT_CONFIG, ...(store.get("config") as AppConfig) };
  },
  update(patch: Partial<AppConfig>): AppConfig {
    const next = { ...this.getAll(), ...patch };
    store.set("config", next);
    return next;
  },
  getStorageState(): string {
    return (store.get("storageState") as string) || "";
  },
  setStorageState(json: string): void {
    store.set("storageState", json);
  },
  clearStorageState(): void {
    store.set("storageState", "");
  },
};
