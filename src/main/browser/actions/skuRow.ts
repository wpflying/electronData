import type { Page } from "playwright";
import type { ProductRow } from "../../../shared/types";
import { ensureLocalImage } from "../../utils/imageCache";
import { logger } from "../../utils/logger";
import { uploadImages } from "./upload";

/**
 * 在拼多多商品发布页"规格与库存"模块新增/编辑一行 SKU
 *
 * 注意：
 * - 当前为"按文本定位"的占位实现，能在多数版本下跑通；如遇页面改版只需调整 SELECTORS
 * - 单元格在表格中通常是 input；若是分屏的"全屏编辑"模式，定位方式需另行调整
 */

const SELECTORS = {
  /** "规格与库存"区域里"添加规格类型"按钮 */
  addSpecTypeBtn: 'button:has-text("添加规格类型")',
  /** 弹窗里规格类型下拉，默认"款式" */
  specTypeSelect: '.spec-type-select, .ant-select:has(.ant-select-selection-item:has-text("款式"))',
  /** "请输入规格名称"输入框（最后一个空白行） */
  specValueInput: 'input[placeholder*="规格名称"]',
  /** 规格行表格 */
  skuTable: 'table:has(th:has-text("库存")):has(th:has-text("拼单价"))',
  /** 表格内：按款式名匹配的某一行 */
  rowByText: (text: string) => `tr:has-text("${text.replace(/"/g, '\\"')}")`,
  /** 行内：库存输入框 */
  rowStock: 'input[name*="stock"], input[placeholder*="库存"], td input',
  /** 行内：规格图上传 input（隐藏） */
  rowImageInput: 'input[type="file"]',
};

/**
 * 在"商品规格"模块的"款式"类型里添加一个新的款式值
 * 如果该款式值已存在则跳过
 */
async function ensureSpecValue(page: Page, value: string): Promise<void> {
  // 已存在则跳过：在规格值列表里查找精确文本
  const exist = await page.locator(`text="${value}"`).first().isVisible().catch(() => false);
  if (exist) return;

  // 找到"请输入规格名称"输入框中最后一个空白的，输入并按回车
  const inputs = page.locator(SELECTORS.specValueInput);
  const count = await inputs.count();
  if (count === 0) {
    logger.warn(`未找到规格值输入框，可能需要先点击"添加规格类型"`);
    return;
  }
  const target = inputs.nth(count - 1);
  await target.click();
  await target.fill(value);
  await target.press("Enter");
  // 等待表格更新
  await page.waitForTimeout(800);
}

/**
 * 给指定 SKU 行填充：库存 / 拼单价 / 单买价 / 规格图 / 规格编码
 */
async function fillSkuRow(page: Page, row: ProductRow): Promise<void> {
  // 定位行：包含 SKU 名称
  const tr = page.locator(SELECTORS.rowByText(row.sku)).first();
  await tr.waitFor({ state: "visible", timeout: 15_000 });

  // 行内 input 顺序通常为：库存 / 拼单价 / 单买价 / [上传图按钮] / 规格编码
  const inputs = tr.locator("input:visible");
  const inputCount = await inputs.count();
  // 不同版本顺序可能略有差异，按下标兜底
  if (inputCount >= 1) await inputs.nth(0).fill(String(row.stock));
  if (inputCount >= 2) await inputs.nth(1).fill(String(row.groupPrice));
  if (inputCount >= 3) await inputs.nth(2).fill(String(row.singlePrice));
  if (row.specCode && inputCount >= 4) {
    // 规格编码通常在第 4 个 input
    await inputs.nth(inputCount - 1).fill(row.specCode);
  }

  // 规格图上传
  if (row.previewImage) {
    try {
      const localPath = await ensureLocalImage(row.previewImage);
      const fileInput = tr.locator(SELECTORS.rowImageInput).first();
      const has = await fileInput.count();
      if (has > 0) {
        await fileInput.setInputFiles(localPath);
        await page.waitForTimeout(1500);
      } else {
        // 找不到行内 input：尝试点击行内的"上传"按钮，再用 setInputFiles 兜底
        await tr.locator("text=/上传|添加图/").first().click().catch(() => undefined);
        await uploadImages(page, 'input[type="file"]', [localPath]).catch(() => undefined);
      }
    } catch (err) {
      logger.warn(`[${row.sku}] 上传规格图失败: ${(err as Error).message}`);
    }
  }
}

/**
 * 主入口：把一行 ProductRow 应用到当前发布页
 *  1. 确保"款式"规格类型下存在该 SKU 名（若不存在则添加）
 *  2. 在生成的 SKU 表格中填充库存/拼单价/单买价/规格图/规格编码
 */
export async function applyProductRow(page: Page, row: ProductRow): Promise<void> {
  logger.info(`填充规格行: ${row.sku}`);
  await ensureSpecValue(page, row.sku);
  await fillSkuRow(page, row);
}
