import type { Page } from "playwright";
import { logger } from "../../utils/logger";

/**
 * 「规格与库存 → 商品规格」模块设置：
 *   1. 删除已有的规格类型（点击「删除规格类型」红字）
 *   2. 点击「添加规格类型(0/2)」按钮
 *   3. 在弹出的下拉里选择「组合」类目
 *   4. 在「请输入规格名称」输入框里逐行输入 Excel 中的 SKU
 *      - 每输入一条按 Enter，下方会自动新增一个空的输入框
 *      - 持续直到所有 SKU 录入完成
 *
 * 注意：选择器集中维护在 SELECTORS，便于页面改版时统一调整
 */

const SELECTORS = {
  /** 商品规格区块（用文本锚点定位整个区块） */
  specSection: ':has-text("商品规格")',
  /** 删除规格类型（红字按钮） */
  deleteSpecType: "text=/删除规格类型/",
  /** 「添加规格类型(0/2)」/「(1/2)」按钮 */
  addSpecType: 'button:has-text("添加规格类型")',
  /**
   * 规格类型下拉触发器（拼多多自研 beast-core 组件）
   * - readonly input，data-testid="beast-core-select-htmlInput"
   * - 仅靠 testid 不够（页面其他下拉同 testid），叠加 placeholder 包含「规格类型」
   * - 取最后一个：每次新加规格都会出现新的"规格类型N"input
   */
  specTypeSelect:
    'input[data-testid="beast-core-select-htmlInput"][placeholder*="规格类型"]',
  /**
   * 下拉浮层中的选项（拼多多自研 beast-core）
   * - DOM 结构：<li role="option" data-checked data-disabled class="cIL_item ...">
   *              <span>选项文本</span>
   *            </li>
   * - 用 role + 内部 span 文本严格匹配最稳
   */
  specTypeOption: 'li[role="option"]:not([data-disabled="true"])',
  /** 规格名称输入框（最后一个空白行） */
  specValueInput: 'input[placeholder*="规格名称"]',
};

/**
 * 删除当前已有的规格类型（如果存在）
 * 拼多多页面会在每个规格类型右上角显示「删除规格类型」红字
 */
export async function deleteAllSpecTypes(page: Page): Promise<void> {
  // 持续点击直到不再出现该按钮（最多防御 3 次）
  for (let i = 0; i < 3; i++) {
    const btn = page.locator(SELECTORS.deleteSpecType).first();
    const visible = await btn.isVisible().catch(() => false);
    if (!visible) break;
    logger.info(`删除已有规格类型（第 ${i + 1} 次）`);
    await btn.click();
    // 弹出"确认删除"二次确认时点确定
    const confirmOk = page
      .locator('button:has-text("确定"), button:has-text("删除")')
      .filter({ hasNot: page.locator(":text('取消')") })
      .first();
    if (await confirmOk.isVisible({ timeout: 1500 }).catch(() => false)) {
      await confirmOk.click().catch(() => undefined);
    }
    await page.waitForTimeout(600);
  }
}

/**
 * 点击「添加规格类型」并在下拉里选择「组合」
 *
 * 拼多多用自研 beast-core 组件，下拉触发器是个 readonly input：
 *   <input readonly placeholder="规格类型1" data-testid="beast-core-select-htmlInput">
 * 注意：页面里有多个 testid 相同的 input，必须叠加 placeholder 包含「规格类型」过滤；
 *      同时取「最后一个」，因为每次添加规格类型都会出现"规格类型N"。
 */
export async function addCombinationSpecType(page: Page): Promise<void> {
  const addBtn = page.locator(SELECTORS.addSpecType).first();
  await addBtn.waitFor({ state: "visible", timeout: 15_000 });
  await addBtn.scrollIntoViewIfNeeded().catch(() => undefined);
  logger.info("点击『添加规格类型』");
  await addBtn.click();
  // 等待新的「规格类型 N」input 出现
  await page
    .waitForSelector(SELECTORS.specTypeSelect, {
      state: "visible",
      timeout: 10_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);

  // 1. 定位最后一个"规格类型 N" input（即刚添加的那个）
  const inputs = page.locator(SELECTORS.specTypeSelect);
  const total = await inputs.count();
  if (total === 0) {
    throw new Error(
      "未找到规格类型下拉触发器（input[data-testid=beast-core-select-htmlInput][placeholder*=规格类型]）",
    );
  }
  const trigger = inputs.nth(total - 1);
  logger.info(`定位到第 ${total} 个规格类型触发器，准备打开下拉`);

  // 2. 打开下拉：readonly input 直接 click 即可；保险起见叠加点击它的父 cell
  await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
  await trigger.click();
  await page.waitForTimeout(300);

  // 兜底：若浮层未出现，再点一次它最近的 InputBlockCell 容器
  let optionVisible = await page
    .locator(SELECTORS.specTypeOption)
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  if (!optionVisible) {
    logger.warn("第一次点击未弹出浮层，尝试点击容器...");
    const container = trigger.locator(
      'xpath=ancestor::*[contains(@class,"IPT_inputBlockCell") or contains(@class,"ST_inputBlockCell")][1]',
    );
    await container.click().catch(() => undefined);
    await page.waitForTimeout(500);
    optionVisible = await page
      .locator(SELECTORS.specTypeOption)
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
  }

  // 3. 在浮层里精确选择「组合」选项
  //    DOM: <li role="option"><span>组合</span></li>
  //    - 用 li[role=option] + 内部 span 文本完全等于 "组合"
  //    - 排除 data-disabled="true" 的项
  //    - 严格相等避免误命中"组合套餐"等
  let option = page
    .locator(SELECTORS.specTypeOption)
    .filter({ has: page.locator("span", { hasText: /^组合$/ }) })
    .first();

  // 兜底 1：上面如果没匹配到，放宽到 li[role=option] 文本严格等于 "组合"
  if (!(await option.isVisible({ timeout: 1500 }).catch(() => false))) {
    option = page
      .locator('li[role="option"]')
      .filter({ hasText: /^组合$/ })
      .first();
  }
  // 兜底 2：极端情况下用纯 span 文本兜底
  if (!(await option.isVisible({ timeout: 1500 }).catch(() => false))) {
    option = page.locator('span:text-is("组合")').first();
  }

  await option.waitFor({ state: "visible", timeout: 10_000 });
  logger.info("选择规格类型『组合』");
  await option.click();

  // 4. 等待规格名称输入框出现（说明类型已选中）
  await page.waitForSelector(SELECTORS.specValueInput, {
    state: "visible",
    timeout: 10_000,
  });
}

/**
 * 单条输入一个 SKU 名（只填一个空白 input + 按 Enter）
 *
 * 用于"每输入一行 SKU 后立刻去填这行的价格库存"的逐行流程。
 * 严格找 placeholder="请输入规格名称" 且 value="" 的 input。
 *
 * @returns 是否成功输入（已存在则返回 false）
 */
export async function addSingleSkuValue(
  page: Page,
  value: string,
): Promise<boolean> {
  const v = value.trim();
  if (!v) return false;

  // 严格相等去重（读已有 input value）
  const existing = await page
    .evaluate((selector) => {
      // @ts-ignore 浏览器侧 document
      const list = Array.from(document.querySelectorAll(selector));
      // @ts-ignore HTMLInputElement
      return list.map((el) => (el as { value?: string }).value || "");
    }, SELECTORS.specValueInput)
    .catch(() => [] as string[]);
  if (existing.includes(v)) {
    logger.info(`SKU 已存在（严格相等），跳过：${v}`);
    return false;
  }

  // 找第一个 value="" 的 input 索引
  const targetIndex = await page
    .evaluate((selector) => {
      // @ts-ignore 浏览器侧 document
      const list = Array.from(document.querySelectorAll(selector));
      for (let i = 0; i < list.length; i++) {
        // @ts-ignore HTMLInputElement
        if (!(list[i] as { value?: string }).value) return i;
      }
      return -1;
    }, SELECTORS.specValueInput)
    .catch(() => -1);

  if (targetIndex < 0) {
    throw new Error("未找到空白的『请输入规格名称』输入框，可能未设置规格类型");
  }

  const inputs = page.locator(SELECTORS.specValueInput);
  const target = inputs.nth(targetIndex);
  await target.click();
  await target.fill(v);
  await target.press("Enter");
  logger.info(`输入 SKU [idx=${targetIndex}]：${v}`);

  // 等待该 SKU 出现在已添加列表（标签）
  // 简化：等"该 input value 已被清空 + 出现新空白 input"
  await page.waitForTimeout(500);
  return true;
}

/**
 * 仅做规格类型前置：删除已有规格 → 添加「组合」类型
 *
 * 不再批量输入 SKU 名。SKU 名由外层「逐行流程」按行调用 addSingleSkuValue。
 *
 * 调试技巧：
 *   - 想在某一步暂停，把对应行下面 await page.pause() 注释解开
 *     page.pause() 会暂停脚本并打开 Playwright Inspector，让你能在浏览器里手动操作
 *   - 也可以用环境变量 PWDEBUG=1 启动 dev：每个动作前自动暂停
 */
export async function setupSpecTypeOnly(page: Page): Promise<void> {
  logger.info("规格前置：删除已有规格 + 添加『组合』类型");
  // await page.pause(); // ← 进入此函数即暂停（解开注释生效）
  await deleteAllSpecTypes(page);
  // await page.pause(); // ← 删除完已有规格后暂停
  await addCombinationSpecType(page);
  // await page.pause(); // ← 选完「组合」后暂停，确认下拉是否选中
  logger.info("规格类型设置完成（待逐行输入 SKU 名）");
}
