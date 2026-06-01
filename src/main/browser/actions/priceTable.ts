import type { Page, Locator } from "playwright";
import type { ProductRow } from "../../../shared/types";
import { logger } from "../../utils/logger";
import { pickImageForRow } from "./imagePicker";

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
 * 让规格输入失焦：触发表格渲染（导出供外部在每次输入 SKU 名后调用）
 */
export async function blurAndTriggerTable(page: Page): Promise<void> {
  logger.info("点击页面空白处，触发价格库存表渲染");
  await page.keyboard.press("Escape").catch(() => undefined);
  // 点击页面靠下的 "商品参考价" 文本（一定不会触发别的）
  const anchor = page
    .locator(
      ':text-is("商品参考价"), :text-is("价格及库存"), :text-is("价格与库存")',
    )
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
async function fillInput(
  page: Page,
  input: Locator,
  value: string,
): Promise<void> {
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
 * 找到 SKU 对应的行（兜底用：tr[data-testid="beast-core-table-body-tr"] + 包含 SKU 文本）
 *
 * 注：拼多多表格里 SKU 文本可能被截断 / 拆到多个子元素，hasText 不一定能命中。
 *    主流程优先按"行索引"定位（参见 fillSingleRow 的 rowIndex 参数）。
 */
function findRowBySku(page: Page, sku: string): Locator {
  return page.locator(SELECTORS.bodyRow).filter({ hasText: sku }).first();
}

/**
 * 等价格库存表内行数 >= expected，最多等 timeout ms
 */
async function waitRowCount(
  page: Page,
  expected: number,
  timeout = 10_000,
): Promise<number> {
  const start = Date.now();
  let last = 0;
  while (Date.now() - start < timeout) {
    last = await page.locator(SELECTORS.bodyRow).count();
    if (last >= expected) return last;
    await page.waitForTimeout(200);
  }
  return last;
}

/**
 * 等价格库存表初次出现（首次进入逐行流程前调用一次）
 */
export async function waitPriceTableReady(page: Page): Promise<void> {
  // 1. 触发表格渲染（点空白处使输入框失焦）
  await blurAndTriggerTable(page);
  // 2. 等表格出现（注意：此时 tbody 里可能没有任何 tr，因为还没输入 SKU）
  await page
    .waitForSelector(SELECTORS.table, { state: "visible", timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

/**
 * 单行填充：填某一个 SKU 行的库存 / 拼单价 / 单买价 / 规格编码 / 预览图
 *
 * 用于「逐行流程」：每输入一行 SKU 名 → 立刻填这行的价格库存 → 再输下一行 SKU
 *
 * @param rowIndex 该 SKU 对应的表格行索引（0 起）。
 *   传入则直接按 nth(rowIndex) 定位；不传则按 SKU 文本兜底。
 */
export async function fillSingleRow(
  page: Page,
  row: ProductRow,
  rowIndex?: number,
): Promise<void> {
  logger.info(`填写单行：${row.sku} (rowIndex=${rowIndex ?? "byText"})`);

  // 1. 定位目标行
  let tr: Locator;
  if (typeof rowIndex === "number") {
    // 主路径：按行索引（最稳，不受文本截断影响）
    // !! 关键：先点击空白处让规格名 input 失焦，触发拼多多 React 把新 SKU 渲染成新行
    //    第一次进来时 waitPriceTableReady 已经 blur 过；后续每行都需要再 blur
    if (rowIndex > 0) {
      await blurAndTriggerTable(page);
    }
    // 先等"行数 >= rowIndex + 1"
    const got = await waitRowCount(page, rowIndex + 1, 10_000);
    if (got < rowIndex + 1) {
      logger.warn(
        `等不到第 ${rowIndex + 1} 行（当前 ${got} 行），可能 SKU 名输入未生效`,
      );
      return;
    }
    tr = page.locator(SELECTORS.bodyRow).nth(rowIndex);
  } else {
    // 兜底路径：按文本
    tr = findRowBySku(page, row.sku);
    await tr
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => undefined);
  }

  if (!(await tr.isVisible().catch(() => false))) {
    logger.warn(`未找到 SKU 行：${row.sku}，跳过`);
    return;
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

  // 预览图：通过拼多多"图片空间"按文件名搜索 + 选第一张
  if (row.imageFileName) {
    logger.info(
      `[${row.sku}] 开始通过图片空间选择预览图：${row.imageFileName}`,
    );
    await pickImageForRow(page, tr, row.imageFileName);
    logger.info(`✓ 预览图已选择`);
  } else {
    logger.warn(`[${row.sku}] 未提供 imageFileName，跳过预览图`);
  }
}

/**
 * 主入口：把每行 ProductRow 填到价格库存表（一次性批量；保留向后兼容）
 *
 * 注：当前主流程已改为「逐行：addSingleSkuValue → fillSingleRow」，
 *      这个批量版本仅在调试/重试时使用。
 */
export async function fillPriceTable(
  page: Page,
  rows: ProductRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await waitPriceTableReady(page);
  for (let i = 0; i < rows.length; i++) {
    logger.info(`填写第 ${i + 1}/${rows.length} 行：${rows[i].sku}`);
    await fillSingleRow(page, rows[i]);
  }
  logger.info("价格与库存批量填充完成");
}
