import { app } from "electron";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { logger } from "./logger";

/**
 * 图片下载工具
 * - 把 http(s) 图片下载到本地临时目录
 * - 同 URL 命中缓存复用
 * - 用于拼多多发布页 input[type=file] 上传场景（必须本地路径）
 */

let cacheDir: string | null = null;

function getCacheDir(): string {
  if (cacheDir) return cacheDir;
  // 走 userData，写入受控
  const dir = join(app.getPath("userData"), "image-cache");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cacheDir = dir;
  return dir;
}

function urlToFilename(url: string): string {
  const hash = createHash("md5").update(url).digest("hex");
  // 推断扩展名
  const m = url.match(/\.(png|jpe?g|gif|webp|bmp)(\?|$)/i);
  const ext = m ? m[1].toLowerCase() : "jpg";
  return `${hash}.${ext}`;
}

/**
 * 下载图片到本地，返回绝对路径
 * 若输入已是本地路径则原样返回
 */
export async function ensureLocalImage(input: string): Promise<string> {
  if (!/^https?:\/\//i.test(input)) {
    return input;
  }
  const dir = getCacheDir();
  const filepath = join(dir, urlToFilename(input));
  if (existsSync(filepath)) return filepath;

  logger.info(`下载图片: ${input}`);
  const res = await fetch(input);
  if (!res.ok) {
    throw new Error(`图片下载失败 HTTP ${res.status}: ${input}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(filepath, buf);
  return filepath;
}

/** 批量本地化 */
export async function ensureLocalImages(inputs: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const i of inputs) {
    try {
      results.push(await ensureLocalImage(i));
    } catch (err) {
      logger.warn(`跳过图片：${(err as Error).message}`);
    }
  }
  return results;
}
