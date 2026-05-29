// 主进程与渲染进程通用类型定义

/** 单个 SKU 数据（多规格商品的某一行） */
export interface SkuRow {
  /** 规格1名称，如「颜色」 */
  spec1Name?: string;
  spec1Value?: string;
  spec2Name?: string;
  spec2Value?: string;
  /** 拼单价（元） */
  groupPrice: number;
  /** 单买价（元），可空，默认与拼单价一致 */
  singlePrice?: number;
  /** 库存 */
  stock: number;
  /** 商家编码 */
  outerId?: string;
}

/** 一个商品（含多个 SKU） */
export interface ProductItem {
  /** 内部唯一 id：title+categoryPath 合并后生成 */
  id: string;
  title: string;
  categoryPath: string;
  marketPrice: number;
  /** 主图本地绝对路径数组 */
  mainImages: string[];
  /** 详情页 HTML 或图片路径列表 */
  detailHtml?: string;
  freightTemplate: string;
  returnPolicy?: string;
  /** SKU 列表，至少有一条；无规格商品也用一条占位 */
  skus: SkuRow[];
}

/** Excel 校验失败信息 */
export interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

/** Excel 解析结果 */
export interface ParseResult {
  products: ProductItem[];
  errors: ValidationError[];
}

/** 任务状态 */
export type TaskStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "retrying"
  | "blocked"; // 验证码 / 风控等待人工

/** 任务实时状态 */
export interface TaskState {
  productId: string;
  title: string;
  status: TaskStatus;
  /** 失败原因 / 当前阶段 */
  message?: string;
  /** 上架成功后返回的拼多多商品 ID */
  goodsId?: string;
  /** 失败截图绝对路径 */
  screenshotPath?: string;
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
}

/** 应用配置 */
export interface AppConfig {
  /** 飞书/钉钉 Webhook 地址 */
  webhookUrl?: string;
  /** 单商品最大重试次数 */
  maxRetries: number;
  /** 单商品间隔（ms） */
  intervalMs: number;
  /** 是否无头模式（调试用） */
  headless: boolean;
}

/** 渲染进程通过 preload 调用主进程能力 */
export interface IpcApi {
  // 配置
  getConfig: () => Promise<AppConfig>;
  setConfig: (cfg: Partial<AppConfig>) => Promise<AppConfig>;

  // 登录
  loginPdd: () => Promise<{ ok: boolean; message?: string }>;
  isLoggedIn: () => Promise<boolean>;

  // Excel
  pickExcel: () => Promise<string | null>;
  parseExcel: (filePath: string) => Promise<ParseResult>;

  // 任务
  startBatch: (products: ProductItem[]) => Promise<void>;
  stopBatch: () => Promise<void>;

  // 商品 Excel + 创建任务
  pickProductExcel: () => Promise<ProductExcelResult | null>;
  startCreate: (params: CreateTaskParams) => Promise<void>;
  stopCreate: () => Promise<void>;

  // 事件订阅
  onTaskUpdate: (cb: (state: TaskState) => void) => () => void;
  onLog: (cb: (line: string) => void) => () => void;
  onCreateProgress: (cb: (state: CreateProgressState) => void) => () => void;
}

/** 创建任务入参（新交互流程） */
export interface CreateTaskParams {
  /** 第 2 步：搜索链接 / 商机搜索链接（用作上下文，可选） */
  searchUrl: string;
  /** 第 3 步：商品 SKU 行列表（来自 Excel） */
  productRows: ProductRow[];
  /** 第 4 步：每个商品创建几次 */
  timesPerProduct: number;
}

/**
 * Excel 商品 SKU 行
 * 表头映射：SKU / 库存 / 拼单价(元) / 单买价(元) / 预览图 / 规格
 * 用于发布页"规格与库存"模块逐行填充
 */
export interface ProductRow {
  /** SKU 款式名称，如「超品质【黑娃+随机裤袜】单人玩套装」 */
  sku: string;
  /** 库存 */
  stock: number;
  /** 拼单价（元） */
  groupPrice: number;
  /** 单买价（元） */
  singlePrice: number;
  /**
   * 预览图（规格图）
   * - 本地绝对路径（filePath:开头）
   * - HTTP URL（http(s)://开头），将由主进程下载到临时目录后再上传
   * - 多张用 ; 分隔，仅取第一张作为规格主图
   */
  previewImage?: string;
  /** 规格编码，如 ZJJQHW*1 */
  specCode?: string;
}

/** 商品 Excel 解析结果 */
export interface ProductExcelResult {
  filePath: string;
  rows: ProductRow[];
  errors: ValidationError[];
}

/** 创建任务实时进度 */
export interface CreateProgressState {
  /** 当前正在处理的 SKU 名称 */
  currentSku?: string;
  /** 已完成次数 */
  finished: number;
  /** 总次数（productRows.length * timesPerProduct） */
  total: number;
  /** 成功 / 失败 / 阻塞 */
  success: number;
  failed: number;
  blocked: number;
  /** 是否正在运行 */
  running: boolean;
  /** 最近一条消息 */
  message?: string;
}

export const IPC_CHANNELS = {
  GET_CONFIG: "config:get",
  SET_CONFIG: "config:set",
  LOGIN_PDD: "pdd:login",
  IS_LOGGED_IN: "pdd:isLoggedIn",
  PICK_EXCEL: "excel:pick",
  PARSE_EXCEL: "excel:parse",
  START_BATCH: "batch:start",
  STOP_BATCH: "batch:stop",
  PICK_PRODUCT_EXCEL: "create:pickProductExcel",
  START_CREATE: "create:start",
  STOP_CREATE: "create:stop",
  CREATE_PROGRESS: "create:progress",
  TASK_UPDATE: "task:update",
  LOG: "log:line",
} as const;
