import type { Page, Locator } from "playwright";
import type { ProductRow } from "../../../shared/types";
import { ensureLocalImage } from "../../utils/imageCache";
import { logger } from "../../utils/logger";

/**
 * 「价格与库存」表格批量填充
 *
 * DOM 结构（拼多多自研 beast-core）：
 *   table[data-testid="beast-core-table"]
 *     thead
 *     tbody[data-testid="beast-core-table-middle-tbody"]
 *       tr[data-testid="beast-core-table-body-tr"]    ← 一行 = 一个 SKU
 *         td (组合: SKU 名称文本)
 *         td.sku-input.quantity (库存)
 *           div[data-testid="beast-core-input"]
 *             input[data-testid="beast-core-input-htmlInput" placeholder="请输入"]
 *         td.sku-input (拼单价)
 *           div[data-testid="beast-core-inputNumber"]
 *             input[data-testid="beast-core-inputNumber-htmlInput"]
 *         td.sku-input (单买价) 同上
 *         td (预览图: input[type=file])
 *         td.sku-input (规格编码) 同 beast-core-input
 *         td (状态: 开关)
 *
 * 列顺序（截图）：组合 / 库存 / 拼单价(元) / 单买价(元) / 预览图 / 规格编码 / 状态
 */

const SELECTORS = {
  /** 价格库存表的根容器 */
  table: 'div[data-testid="beast-core-table"]',
  /** 表行 */
  bodyRow: 'tr[data-testid="beast-core-table-body-tr"]',
  /** 普通文本 input 的真实 input 元素（库存、规格编码） */
  textInput: 'input[data-testid="beast-core-input-htmlInput"]',
  /** 数字 input 的真实 input 元素（拼单价、单买价） */
  numberInput: 'input[data-testid="beast-core-inputNumber-htmlInput"]',
  /** 行内文件 input（预览图） */
  fileInput: 'input[type="file"]',
};

/**
 * 让规格输入失焦：触发表格渲染
 */
async function blurAndTriggerTable(page: Page): Promise<void> {
  logger.info("点击页面空白处，触发价格库存表渲染");
  await page.keyboard.press("Escape").catch(() => undefined);
  // 点击页面靠下的 "商品参考价" 文本（一定不会触发别的）
  const anchor = page
    .locator(':text-is("商品参考价"), :text-is("价格及库存"), :text-is("价格与库存")')
    .first();
  if (await anchor.isVisible({ timeout: 1500 }).catch(() => false)) {
    await anchor.click({ force: true }).catch(() => undefined);
  } else {
    await page.mouse.click(10, 200).catch(() => undefined);
  }
  await page.waitForTimeout(800);
}

/**
 * 在 input 中填值（兼容 React 受控组件）
 *
 * 原因：拼多多用 React + 自研 input，直接调用 fill() 不会触发 React 的 onChange，
 *      所以页面虽然显示了值但内部 state 没更新；保存时还是空。
 *
 * 解决：click → 全选 → Backspace 清空 → page.keyboard.type 模拟真实键入
 */
async function fillInput(page: Page, input: Locator, value: string): Promise<void> {
  await input.scrollIntoViewIfNeeded().catch(() => undefined);
  await input.click({ force: true });
  await page.waitForTimeout(80);
  // 全选删除原值
  await input.press("Meta+A").catch(() => undefined);
  await input.press("Backspace").catch(() => undefined);
  // 模拟真实键入（每键 30ms，确保 React 能逐个收到 input 事件）
  await page.keyboard.type(value, { delay: 30 });
  // 失焦让 onBlur 触发校验
  await input.press("Tab").catch(() => undefined);
  await page.waitForTimeout(80);
}

/**
 * 找到 SKU 对应的行（tr[data-testid="beast-core-table-body-tr"] + 包含 SKU 文本）
 */
function findRowBySku(page: Page, sku: string): Locator {
  return page
    .locator(SELECTORS.bodyRow)
    .filter({ hasText: sku })
    .first();
}

/**
 * 行内上传预览图
 */
async function uploadRowImage(row: Locator, image: string): Promise<void> {
  const fileInput = row.locator(SELECTORS.fileInput).first();
  if ((await fileInput.count()) === 0) {
    logger.warn("行内未找到 input[type=file]，跳过预览图上传");
    return;
  }
  const localPath = await ensureLocalImage(image);
  await fileInput.setInputFiles(localPath);
}

/**
 * 主入口：把每行 ProductRow 填到价格库存表
 */
export async function fillPriceTable(
  page: Page,
  rows: ProductRow[],
): Promise<void> {
  if (rows.length === 0) return;

  // 1. 触发表格渲染
  await blurAndTriggerTable(page);

  // 2. 等表格出现
  await page
    .waitForSelector(SELECTORS.table, { state: "visible", timeout: 15_000 })
    .catch(() => undefined);
  await page
    .waitForSelector(SELECTORS.bodyRow, { state: "visible", timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);

  // 3. 逐行填充
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    logger.info(`填写第 ${i + 1}/${rows.length} 行：${row.sku}`);

    const tr = findRowBySku(page, row.sku);
    if (!(await tr.isVisible().catch(() => false))) {
      logger.warn(`未找到 SKU 行：${row.sku}，跳过`);
      continue;
    }
    await tr.scrollIntoViewIfNeeded().catch(() => undefined);

    // 行内的两类 input：
    //   - textInput[]:  库存、规格编码  （beast-core-input-htmlInput）
    //   - numberInput[]: 拼单价、单买价  （beast-core-inputNumber-htmlInput）
    const textInputs = tr.locator(SELECTORS.textInput);
    const numberInputs = tr.locator(SELECTORS.numberInput);
    const textCount = await textInputs.count();
    const numberCount = await numberInputs.count();
    logger.info(
      `[${row.sku}] 行内 textInput=${textCount} numberInput=${numberCount}`,
    );

    // 库存：第一个 textInput
    if (textCount >= 1) {
      await fillInput(page, textInputs.nth(0), String(row.stock));
      logger.info(`✓ 库存=${row.stock}`);
    } else {
      logger.warn(`[${row.sku}] 未找到库存 input`);
    }

    // 拼单价：第一个 numberInput
    if (numberCount >= 1) {
      await fillInput(page, numberInputs.nth(0), String(row.groupPrice));
      logger.info(`✓ 拼单价=${row.groupPrice}`);
    }

    // 单买价：第二个 numberInput
    if (numberCount >= 2) {
      await fillInput(page, numberInputs.nth(1), String(row.singlePrice));
      logger.info(`✓ 单买价=${row.singlePrice}`);
    }

    // 规格编码：第二个 textInput（如果有）
    if (row.specCode && textCount >= 2) {
      await fillInput(page, textInputs.nth(1), row.specCode);
      logger.info(`✓ 规格编码=${row.specCode}`);
    }

    // 预览图
    if (row.previewImage) {
      try {
        await uploadRowImage(tr, row.previewImage);
        await page.waitForTimeout(800);
        logger.info(`✓ 上传预览图`);
      } catch (err) {
        logger.warn(`[${row.sku}] 上传预览图失败：${(err as Error).message}`);
      }
    }
  }

  logger.info("价格与库存批量填充完成");
}
