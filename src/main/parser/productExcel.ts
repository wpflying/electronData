import * as XLSX from "xlsx";
import { existsSync } from "fs";
import { isAbsolute, resolve, dirname } from "path";
import type { ProductRow, ValidationError } from "../../shared/types";

/**
 * 解析"商品 SKU Excel"
 *
 * 期望表头（顺序无所谓，只看名称，支持小写/全角空格变体）：
 *   SKU         款式名称
 *   库存
 *   拼单价(元)   或 拼单价
 *   单买价(元)   或 单买价
 *   预览图       本地路径或 http URL，多张用 ; 分隔
 *   规格         规格编码（spec code）
 *
 * 每一行对应拼多多发布页"规格与库存"模块的一行 SKU。
 */

interface RawRow {
  [key: string]: unknown;
}

/**
 * 表头别名归一化：把不同写法都映射到内部键
 */
const HEADER_MAP: Record<string, keyof ProductRow> = {
  sku: "sku",
  款式: "sku",
  款式名称: "sku",
  规格名称: "sku",
  库存: "stock",
  库存量: "stock",
  拼单价: "groupPrice",
  "拼单价(元)": "groupPrice",
  "拼单价（元）": "groupPrice",
  团购价: "groupPrice",
  单买价: "singlePrice",
  "单买价(元)": "singlePrice",
  "单买价（元）": "singlePrice",
  零售价: "singlePrice",
  预览图: "previewImage",
  图片: "previewImage",
  主图: "previewImage",
  规格图: "previewImage",
  规格: "specCode",
  规格编码: "specCode",
  商家编码: "specCode",
  // SKU 在拼多多"图片空间"里搜索的文件名
  sku文件名称: "imageFileName",
  sku文件名: "imageFileName",
  图片名称: "imageFileName",
  图片文件名: "imageFileName",
  图片名: "imageFileName",
  文件名: "imageFileName",
  imagename: "imageFileName",
  imagefilename: "imageFileName",
};

/** 把单元格 key 标准化（去空格、转小写英文） */
function normalizeKey(key: string): string {
  return String(key).trim().replace(/\s+/g, "").toLowerCase();
}

/** 构建一份"标准化 key -> 字段名"的映射 */
function buildLookup(): Record<string, keyof ProductRow> {
  const lookup: Record<string, keyof ProductRow> = {};
  Object.entries(HEADER_MAP).forEach(([k, v]) => {
    lookup[normalizeKey(k)] = v;
  });
  return lookup;
}

/** 字符串 / 数字 -> number */
function toNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * 把任意原始行（key 可能是中文表头）映射成 ProductRow 的部分字段
 */
function mapRow(
  raw: RawRow,
  lookup: Record<string, keyof ProductRow>,
): Partial<ProductRow> {
  const out: Partial<ProductRow> = {};
  Object.entries(raw).forEach(([k, v]) => {
    const field = lookup[normalizeKey(k)];
    if (!field) return;
    if (
      field === "stock" ||
      field === "groupPrice" ||
      field === "singlePrice"
    ) {
      const n = toNumber(v);
      if (n !== null) (out as Record<string, unknown>)[field] = n;
    } else {
      const s = v === undefined || v === null ? "" : String(v).trim();
      if (s) (out as Record<string, unknown>)[field] = s;
    }
  });
  return out;
}

/**
 * 解析预览图字段：
 * - 支持 ; 或 ；分隔多张
 * - 本地路径：相对于 Excel 所在目录解析
 * - http(s) 链接：保持原样，由后续上传流程下载
 */
function resolvePreviewImage(
  raw: string | undefined,
  baseDir: string,
): string | undefined {
  if (!raw) return undefined;
  const first = raw
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!first) return undefined;
  if (/^https?:\/\//i.test(first)) return first;
  return isAbsolute(first) ? first : resolve(baseDir, first);
}

export interface ParseProductExcelResult {
  rows: ProductRow[];
  errors: ValidationError[];
}

export function parseProductExcel(filePath: string): ParseProductExcelResult {
  const errors: ValidationError[] = [];
  if (!existsSync(filePath)) {
    return {
      rows: [],
      errors: [{ rowIndex: -1, field: "file", message: "文件不存在" }],
    };
  }

  const baseDir = dirname(filePath);
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      errors: [
        { rowIndex: -1, field: "sheet", message: "Excel 中无任何工作表" },
      ],
    };
  }
  const ws = wb.Sheets[sheetName];
  const raws = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: "" });

  const lookup = buildLookup();
  const rows: ProductRow[] = [];

  raws.forEach((raw, idx) => {
    // Excel 行号从 2 开始（第一行表头）
    const rowIndex = idx + 2;
    const partial = mapRow(raw, lookup);

    // 必填校验
    const sku = (partial.sku || "").toString().trim();
    if (!sku) {
      errors.push({ rowIndex, field: "sku", message: "SKU 不能为空" });
      return;
    }
    if (typeof partial.stock !== "number" || partial.stock < 0) {
      errors.push({ rowIndex, field: "stock", message: "库存无效" });
      return;
    }
    if (typeof partial.groupPrice !== "number" || partial.groupPrice <= 0) {
      errors.push({ rowIndex, field: "groupPrice", message: "拼单价无效" });
      return;
    }
    // 单买价非必填，缺省 = 拼单价
    const singlePrice =
      typeof partial.singlePrice === "number" && partial.singlePrice > 0
        ? partial.singlePrice
        : partial.groupPrice;

    // 预览图本地文件存在性校验
    const previewImage = resolvePreviewImage(
      partial.previewImage as string,
      baseDir,
    );
    if (
      previewImage &&
      !/^https?:\/\//i.test(previewImage) &&
      !existsSync(previewImage)
    ) {
      errors.push({
        rowIndex,
        field: "previewImage",
        message: `预览图文件不存在: ${previewImage}`,
      });
      // 仍然保留行，但清掉预览图，避免后续流程报错
      partial.previewImage = undefined;
    }

    rows.push({
      sku,
      stock: partial.stock,
      groupPrice: partial.groupPrice,
      singlePrice,
      previewImage,
      specCode: partial.specCode as string | undefined,
      imageFileName: partial.imageFileName as string | undefined,
    });
  });

  return { rows, errors };
}
