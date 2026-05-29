import * as XLSX from 'xlsx';
import { existsSync } from 'fs';
import { resolve, isAbsolute, dirname } from 'path';
import type { ProductItem, ParseResult, SkuRow, ValidationError } from '../../shared/types';

/**
 * Excel 解析与字段校验
 * 同一 title + categoryPath 的行被合并为同一商品的多 SKU
 */

interface RawRow {
  title?: string;
  categoryPath?: string;
  marketPrice?: number | string;
  groupPrice?: number | string;
  singlePrice?: number | string;
  stock?: number | string;
  outerId?: string;
  spec1Name?: string;
  spec1Value?: string;
  spec2Name?: string;
  spec2Value?: string;
  mainImages?: string;
  detailHtml?: string;
  freightTemplate?: string;
  returnPolicy?: string;
}

/** 把字符串数字转 number */
function toNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** 解析图片相对路径：相对于 Excel 所在目录 */
function resolveImagePaths(raw: string | undefined, baseDir: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (isAbsolute(p) ? p : resolve(baseDir, p)));
}

export async function parseExcel(filePath: string): Promise<ParseResult> {
  const errors: ValidationError[] = [];
  const productMap = new Map<string, ProductItem>();

  if (!existsSync(filePath)) {
    return {
      products: [],
      errors: [{ rowIndex: -1, field: 'file', message: '文件不存在' }],
    };
  }

  const baseDir = dirname(filePath);
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return {
      products: [],
      errors: [{ rowIndex: -1, field: 'sheet', message: 'Excel 中无任何工作表' }],
    };
  }

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '' });

  rows.forEach((row, idx) => {
    // Excel 行号从 2 开始（首行表头）
    const rowIndex = idx + 2;

    const title = (row.title || '').toString().trim();
    const categoryPath = (row.categoryPath || '').toString().trim();
    const marketPrice = toNumber(row.marketPrice);
    const groupPrice = toNumber(row.groupPrice);
    const stock = toNumber(row.stock);
    const freightTemplate = (row.freightTemplate || '').toString().trim();

    if (!title) {
      errors.push({ rowIndex, field: 'title', message: '商品标题不能为空' });
      return;
    }
    if (title.length > 60) {
      errors.push({ rowIndex, field: 'title', message: '标题超过 60 字符' });
    }
    if (!categoryPath) {
      errors.push({ rowIndex, field: 'categoryPath', message: '类目路径不能为空' });
      return;
    }
    if (marketPrice === null) {
      errors.push({ rowIndex, field: 'marketPrice', message: '市场价无效' });
      return;
    }
    if (groupPrice === null) {
      errors.push({ rowIndex, field: 'groupPrice', message: '拼单价无效' });
      return;
    }
    if (stock === null || stock < 0) {
      errors.push({ rowIndex, field: 'stock', message: '库存无效' });
      return;
    }
    if (!freightTemplate) {
      errors.push({ rowIndex, field: 'freightTemplate', message: '运费模板不能为空' });
      return;
    }

    const mainImages = resolveImagePaths(row.mainImages, baseDir);
    if (mainImages.length === 0) {
      errors.push({ rowIndex, field: 'mainImages', message: '主图不能为空' });
      return;
    }
    // 校验主图文件存在
    const missing = mainImages.filter((p) => !existsSync(p));
    if (missing.length > 0) {
      errors.push({
        rowIndex,
        field: 'mainImages',
        message: `主图文件不存在: ${missing.join(', ')}`,
      });
      return;
    }

    const sku: SkuRow = {
      spec1Name: row.spec1Name?.toString().trim() || undefined,
      spec1Value: row.spec1Value?.toString().trim() || undefined,
      spec2Name: row.spec2Name?.toString().trim() || undefined,
      spec2Value: row.spec2Value?.toString().trim() || undefined,
      groupPrice,
      singlePrice: toNumber(row.singlePrice) ?? undefined,
      stock,
      outerId: row.outerId?.toString().trim() || undefined,
    };

    const key = `${title}__${categoryPath}`;
    const exist = productMap.get(key);
    if (exist) {
      exist.skus.push(sku);
      return;
    }
    productMap.set(key, {
      id: key,
      title,
      categoryPath,
      marketPrice,
      mainImages,
      detailHtml: row.detailHtml?.toString().trim() || undefined,
      freightTemplate,
      returnPolicy: row.returnPolicy?.toString().trim() || undefined,
      skus: [sku],
    });
  });

  return { products: Array.from(productMap.values()), errors };
}
