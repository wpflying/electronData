import { configStore } from '../store/config';
import { logger } from '../utils/logger';

/**
 * 飞书 / 钉钉 Webhook 通知
 * 自动识别 URL 来判定平台格式：
 * - 飞书：https://open.feishu.cn/open-apis/bot/v2/hook/xxx
 * - 钉钉：https://oapi.dingtalk.com/robot/send?access_token=xxx
 */

async function postJson(url: string, body: unknown): Promise<void> {
  // Node 18+ 自带全局 fetch
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

function buildPayload(url: string, content: string): unknown {
  if (url.includes('feishu')) {
    return { msg_type: 'text', content: { text: content } };
  }
  if (url.includes('dingtalk')) {
    return { msgtype: 'text', text: { content } };
  }
  // 默认通用格式
  return { text: content };
}

/** 实时告警（验证码/风控/连续失败） */
export async function notifyAlert(content: string): Promise<void> {
  const { webhookUrl } = configStore.getAll();
  if (!webhookUrl) return;
  try {
    await postJson(webhookUrl, buildPayload(webhookUrl, `[拼多多上架告警] ${content}`));
  } catch (err) {
    logger.warn(`Webhook 告警失败: ${(err as Error).message}`);
  }
}

/** 任务结束汇总 */
export async function notifyReport(
  summary: { success: number; failed: number; blocked: number },
  total: number,
): Promise<void> {
  const { webhookUrl } = configStore.getAll();
  if (!webhookUrl) return;
  const text =
    `[拼多多上架完成] 共 ${total} 件\n` +
    `成功: ${summary.success}\n` +
    `失败: ${summary.failed}\n` +
    `阻塞: ${summary.blocked}`;
  try {
    await postJson(webhookUrl, buildPayload(webhookUrl, text));
  } catch (err) {
    logger.warn(`Webhook 汇总通知失败: ${(err as Error).message}`);
  }
}
