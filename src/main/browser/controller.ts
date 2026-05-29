import { chromium, Browser, BrowserContext, Page } from "playwright";
import { app, dialog, BrowserWindow } from "electron";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { configStore } from "../store/config";
import { logger } from "../utils/logger";

/**
 * Playwright 浏览器控制器
 * - 单例：全局共用一个 browser + context（单账号串行）
 * - storageState 持久化：保存到 electron-store，复用 Cookie / LocalStorage
 * - 已注入：用户手动点击 input[type=file] 时弹出 Electron 原生选择框
 *   原因：Playwright 自动化模式默认拦截系统文件选择器，导致"用户在浏览器里手动上传"失败
 */

const PDD_HOME = "https://mms.pinduoduo.com/";
const PDD_LOGIN = "https://mms.pinduoduo.com/login";

class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  /** 截图目录 */
  private get screenshotDir(): string {
    const dir = join(app.getPath("userData"), "screenshots");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * 给 Page 绑定文件选择器代理：
   * 当用户在浏览器里点击 <input type="file"> 时，
   * 用 Electron 的原生 dialog 弹文件选择框，再把结果回灌给 input。
   *
   * 注：Playwright 的 filechooser 默认是 "non-handled"，必须我们主动处理，
   *     否则用户那次点击就石沉大海，看起来像"上传失败"。
   */
  private bindFileChooserProxy(page: Page): void {
    page.on("filechooser", async (chooser) => {
      try {
        const parent = BrowserWindow.getAllWindows()[0];
        const result = await dialog.showOpenDialog(parent, {
          title: "选择要上传的文件",
          properties: chooser.isMultiple()
            ? ["openFile", "multiSelections"]
            : ["openFile"],
        });
        if (result.canceled || result.filePaths.length === 0) {
          // 用户取消选择：必须给 setFiles 一个空数组，否则 chooser 会一直挂起
          await chooser.setFiles([]);
          return;
        }
        await chooser.setFiles(result.filePaths);
        logger.info(
          `用户手动上传：${result.filePaths.length} 个文件 -> ${result.filePaths.join(", ")}`,
        );
      } catch (err) {
        logger.error(`处理文件选择失败：${(err as Error).message}`);
      }
    });
  }

  /** 启动浏览器并恢复登录态 */
  async ensureContext(): Promise<{ context: BrowserContext; page: Page }> {
    if (this.context && this.page && !this.page.isClosed()) {
      return { context: this.context, page: this.page };
    }
    const cfg = configStore.getAll();
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: cfg.headless,
        // 反自动化指纹：减少被拼多多识别为爬虫的概率
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
      });
      logger.info("Playwright Chromium 已启动");
    }

    const stateRaw = configStore.getStorageState();
    this.context = await this.browser.newContext(
      stateRaw ? { storageState: JSON.parse(stateRaw) } : {},
    );
    // 监听新开的页面，统一绑定文件选择代理
    this.context.on("page", (newPage) => this.bindFileChooserProxy(newPage));
    this.page = await this.context.newPage();
    this.bindFileChooserProxy(this.page);
    return { context: this.context, page: this.page };
  }

  /** 触发交互式登录：打开登录页等待人工扫码 */
  async interactiveLogin(): Promise<{ ok: boolean; message?: string }> {
    try {
      const { context, page } = await this.ensureContext();
      await page.goto(PDD_LOGIN, { waitUntil: "domcontentloaded" });
      logger.info("已打开拼多多登录页，等待人工完成扫码或验证...");

      // 轮询判定登录成功：
      //   1) URL 离开 /login 且仍在 mms.pinduoduo.com（含 captcha 中转）
      //   2) cookie 中出现登录态关键 key（PASS_ID / mms_b84d1838... 等）
      // 给人工充足时间：15 分钟
      const deadline = Date.now() + 15 * 60 * 1000;
      let success = false;
      while (Date.now() < deadline) {
        if (page.isClosed()) break;
        const url = page.url();
        const inMms = url.includes("mms.pinduoduo.com");
        const notLogin = !url.includes("/login");
        if (inMms && notLogin) {
          success = true;
          break;
        }
        // 检查 cookie 中是否已经写入登录态
        const cookies = await context
          .cookies("https://mms.pinduoduo.com")
          .catch(() => []);
        const hasPass = cookies.some(
          (c) =>
            c.name === "PASS_ID" ||
            c.name.startsWith("mms_b84d1838") ||
            c.name === "JSESSIONID",
        );
        if (hasPass && notLogin) {
          success = true;
          break;
        }
        await page.waitForTimeout(1500);
      }

      if (!success) {
        return { ok: false, message: "登录超时（15 分钟未完成），请重试" };
      }

      // 持久化登录态
      const state = await context.storageState();
      configStore.setStorageState(JSON.stringify(state));
      logger.info("登录态已保存");
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`登录失败: ${msg}`);
      // 即使流程异常，也尝试保存当前已经拿到的 cookie，避免下次还得重扫
      try {
        if (this.context) {
          const state = await this.context.storageState();
          configStore.setStorageState(JSON.stringify(state));
          logger.info("已尝试保留当前 cookie 状态");
        }
      } catch {
        /* ignore */
      }
      return { ok: false, message: msg };
    }
  }

  /** 是否已有有效登录态：仅做存在性检查，真实有效性由首次访问验证 */
  async isLoggedIn(): Promise<boolean> {
    const raw = configStore.getStorageState();
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const cookies = parsed?.cookies as
        | Array<{ name: string; expires?: number }>
        | undefined;
      if (!cookies || cookies.length === 0) return false;
      // 简化：存在 cookie 即认为有登录态，过期由后续上架流程兜底
      return true;
    } catch {
      return false;
    }
  }

  /** 截图保存到本地，返回绝对路径 */
  async screenshot(prefix = "error"): Promise<string | undefined> {
    if (!this.page || this.page.isClosed()) return undefined;
    const filename = `${prefix}-${Date.now()}.png`;
    const filepath = join(this.screenshotDir, filename);
    try {
      const buf = await this.page.screenshot({ fullPage: true });
      // 用 Uint8Array 包装兼容更严格的 TS Buffer 类型
      writeFileSync(filepath, new Uint8Array(buf));
      return filepath;
    } catch (err) {
      logger.warn(`截图失败: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** 获取当前 page，若未启动则启动 */
  async getPage(): Promise<Page> {
    const { page } = await this.ensureContext();
    return page;
  }

  /** 获取当前 BrowserContext（含当前 page）；用于监听 'page' 事件等 */
  async getContext(): Promise<{ context: BrowserContext; page: Page }> {
    return this.ensureContext();
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    try {
      // 退出前持久化最新 storageState
      if (this.context) {
        const state = await this.context.storageState();
        configStore.setStorageState(JSON.stringify(state));
      }
    } catch {
      /* ignore */
    }
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}

export const browserController = new BrowserController();
export const PDD_URLS = { HOME: PDD_HOME, LOGIN: PDD_LOGIN };
