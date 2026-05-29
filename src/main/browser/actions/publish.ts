import type { Page } from 'playwright';
import type { ProductItem } from '../../../shared/types';
import { logger } from '../../utils/logger';
import { uploadImages } from './upload';

/**
 * 单商品发布主流程
 * 注意：选择器为占位实现，需在真实环境中根据拼多多商家后台 DOM 调整
 *
 * 流程概览：
 *   1. 进入商品发布页
 *   2. 选择类目（按 categoryPath 文本逐级点击）
 *   3. 填写基础信息（标题/市场价/拼单价/库存/运费模板）
 *   4. 添加规格 + 生成 SKU 矩阵
 *   5. 上传主图
 *   6. 填写图文详情
 *   7. 提交
 */

const PUBLISH_URL = 'https://mms.pinduoduo.com/goods/goods_add';

/** 选择器集中维护，便于页面改版时快速定位修改 */
const SELECTORS = {
  title: 'input[data-name="goodsName"]',
  marketPrice: 'input[data-name="marketPrice"]',
  groupPrice: 'input[data-name="groupPrice"]',
  stock: 'input[data-name="quantity"]',
  freightTemplate: 'div[data-name="freightTemplate"] .ant-select-selection',
  mainImageInput: 'input[type="file"][data-name="mainImage"]',
  detailImageInput: 'input[type="file"][data-name="detailImage"]',
  categoryCascade: 'div[data-name="catId"]',
  submitBtn: 'button[data-action="submit"]',
  successToast: '.success-toast, .ant-message-success',
};

/** 按类目路径文本逐级选择 */
async function pickCategory(page: Page, categoryPath: string): Promise<void> {
  const segments = categoryPath.split(/[>＞》/]/).map((s) => s.trim()).filter(Boolean);
  await page.click(SELECTORS.categoryCascade);
  for (const seg of segments) {
    const item = page.locator('.category-item, li').filter({ hasText: seg }).first();
    await item.waitFor({ state: 'visible', timeout: 15_000 });
    await item.click();
  }
  // 等待面板收起
  await page.waitForTimeout(500);
}

/** 选择运费模板 */
async function pickFreightTemplate(page: Page, name: string): Promise<void> {
  await page.click(SELECTORS.freightTemplate);
  const opt = page.locator('.ant-select-dropdown li').filter({ hasText: name }).first();
  await opt.waitFor({ state: 'visible', timeout: 10_000 });
  await opt.click();
}

/** 填写一条无规格商品的价格库存 */
async function fillSinglePrice(page: Page, product: ProductItem): Promise<void> {
  const sku = product.skus[0];
  await page.fill(SELECTORS.marketPrice, String(product.marketPrice));
  await page.fill(SELECTORS.groupPrice, String(sku.groupPrice));
  await page.fill(SELECTORS.stock, String(sku.stock));
}

/**
 * 多规格 SKU 矩阵填写：占位实现
 * 真实拼多多页面需要先添加规格名/规格值，再在生成的表格中遍历填写
 */
async function fillSkuMatrix(page: Page, product: ProductItem): Promise<void> {
  // TODO: 根据真实页面实现：
  //   1. 点击「添加规格」-> 选择规格1名称 -> 输入规格值
  //   2. 同样添加规格2
  //   3. 生成的 SKU 表格按 (spec1Value, spec2Value) 定位行，填写价格、库存、商家编码
  logger.warn('多规格 SKU 矩阵填写为占位实现，需根据真实 DOM 完善');
  // 占位：暂用第一个 SKU 当默认价格库存
  await fillSinglePrice(page, product);
}

export interface PublishResult {
  success: boolean;
  goodsId?: string;
  message?: string;
}

export async function publishProduct(page: Page, product: ProductItem): Promise<PublishResult> {
  logger.info(`开始上架: ${product.title}`);
  await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded' });

  // 1. 类目
  await pickCategory(page, product.categoryPath);

  // 2. 标题
  await page.fill(SELECTORS.title, product.title);

  // 3. 主图
  await uploadImages(page, SELECTORS.mainImageInput, product.mainImages);

  // 4. 详情图（如有）
  if (product.detailHtml) {
    // 简化：若 detailHtml 字段为图片路径列表（;分隔），尝试上传到详情图
    const detailFiles = product.detailHtml
      .split(/[;；]/)
      .map((s) => s.trim())
      .filter((p) => /\.(png|jpe?g|gif|webp)$/i.test(p));
    if (detailFiles.length > 0) {
      await uploadImages(page, SELECTORS.detailImageInput, detailFiles).catch((e) => {
        logger.warn(`详情图上传失败: ${(e as Error).message}`);
      });
    }
  }

  // 5. 运费模板
  await pickFreightTemplate(page, product.freightTemplate);

  // 6. 价格 / 库存
  const hasMultiSku = product.skus.length > 1 || (product.skus[0]?.spec1Name && product.skus[0]?.spec1Value);
  if (hasMultiSku) {
    await fillSkuMatrix(page, product);
  } else {
    await fillSinglePrice(page, product);
  }

  // 7. 提交
  await page.click(SELECTORS.submitBtn);

  // 8. 等待结果：成功 toast 或错误信息
  try {
    await page.waitForSelector(SELECTORS.successToast, { timeout: 30_000 });
    // 商品 ID 通常在跳转后的 URL query 中：?goods_id=xxx
    const url = page.url();
    const match = url.match(/goods_id=(\d+)/);
    return { success: true, goodsId: match?.[1] };
  } catch {
    // 抓取错误提示文案
    const errText = await page
      .locator('.ant-message-error, .error-tip')
      .first()
      .innerText()
      .catch(() => '提交后未检测到成功提示');
    return { success: false, message: errText };
  }
}
