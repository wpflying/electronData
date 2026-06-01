import { useEffect, useState } from "react";
import {
  Card,
  Button,
  Space,
  Toast,
  Typography,
  Progress,
  Steps,
  Input,
  InputNumber,
  Tag,
  Table,
  Banner,
  Switch,
} from "@douyinfe/semi-ui";
import type {
  CreateProgressState,
  ProductRow,
  ValidationError,
} from "../../../shared/types";

const { Title, Text, Paragraph } = Typography;

/**
 * 主控台：五步流程交互
 * 1. 用户登录
 * 2. 输入搜索链接
 * 3. 上传商品 SKU Excel（表头：SKU / 库存 / 拼单价(元) / 单买价(元) / 预览图 / 规格）
 * 4. 输入创建次数
 * 5. 开始创建
 */

const Dashboard = () => {
  // ① 登录
  const [logged, setLogged] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  /** 拼多多登录用户名（来自 .user-name-text） */
  const [userName, setUserName] = useState<string>("");

  // ② 搜索链接
  const [searchUrl, setSearchUrl] = useState("");
  // ②.5 用搜索结果中的第几个商品「发布同款」（1 起）
  const [productIndex, setProductIndex] = useState<number>(1);

  // ③ 商品 Excel
  const [excelPath, setExcelPath] = useState("");
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [excelErrors, setExcelErrors] = useState<ValidationError[]>([]);

  // ④ 创建次数
  const [timesPerProduct, setTimesPerProduct] = useState<number>(1);
  // 是否提交后自动上架（默认 true：填表完成后自动点『提交并上架』）
  const [autoSubmit, setAutoSubmit] = useState<boolean>(true);

  // ⑤ 进度
  const [progress, setProgress] = useState<CreateProgressState>({
    finished: 0,
    total: 0,
    success: 0,
    failed: 0,
    blocked: 0,
    running: false,
  });

  /** 当前活跃步骤 */
  const currentStep = (() => {
    if (!logged) return 0;
    if (!searchUrl.trim()) return 1;
    if (productRows.length === 0) return 2;
    if (!timesPerProduct || timesPerProduct < 1) return 3;
    return 4;
  })();

  // 启动时检测登录态
  useEffect(() => {
    window.api.isLoggedIn().then(async (ok) => {
      setLogged(ok);
      if (ok) {
        const name = await window.api.fetchUserName();
        if (name) setUserName(name);
      }
    });
  }, []);

  // 订阅创建进度
  useEffect(() => {
    const off = window.api.onCreateProgress((s) => setProgress(s));
    return off;
  }, []);

  const handleLogin = async () => {
    setLoginLoading(true);
    Toast.info("已打开登录窗口，请在弹出的浏览器中扫码完成登录");
    try {
      const r = await window.api.loginPdd();
      if (r.ok) {
        Toast.success("登录成功");
        setLogged(true);
        // 异步拉一下用户名
        const name = await window.api.fetchUserName();
        if (name) setUserName(name);
      } else {
        Toast.error(`登录失败：${r.message}`);
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handlePickExcel = async () => {
    const r = await window.api.pickProductExcel();
    if (!r) return;
    setExcelPath(r.filePath);
    setProductRows(r.rows);
    setExcelErrors(r.errors);
    if (r.errors.length > 0) {
      Toast.warning(`解析完成，存在 ${r.errors.length} 条字段错误`);
    } else {
      Toast.success(`已读取 ${r.rows.length} 条 SKU`);
    }
  };

  const handleStart = async () => {
    if (!logged) return Toast.warning("请先完成登录");
    if (!searchUrl.trim()) return Toast.warning("请填写搜索链接");
    if (productRows.length === 0) return Toast.warning("请上传商品 SKU Excel");
    if (!timesPerProduct || timesPerProduct < 1)
      return Toast.warning("创建次数需 ≥ 1");

    await window.api.startCreate({
      searchUrl: searchUrl.trim(),
      productIndex,
      productRows,
      timesPerProduct,
      autoSubmit,
    });
  };

  const handleStop = async () => {
    await window.api.stopCreate();
  };

  /** 调试：仅重跑「删除已有规格 + 添加组合 + 输入 SKU」，复用当前发布页 */
  const handleRetrySpecs = async () => {
    if (productRows.length === 0) {
      Toast.warning("请先上传商品 SKU Excel");
      return;
    }
    Toast.info("已发起『重试规格』调试任务，复用当前发布页");
    await window.api.retryCreate({
      searchUrl: searchUrl.trim(),
      productIndex,
      productRows,
      timesPerProduct,
    });
  };

  const percent =
    progress.total === 0
      ? 0
      : Math.round((progress.finished / progress.total) * 100);

  // SKU 表格列定义
  const columns = [
    { title: "SKU", dataIndex: "sku", width: 220, ellipsis: true },
    { title: "库存", dataIndex: "stock", width: 90 },
    { title: "拼单价(元)", dataIndex: "groupPrice", width: 100 },
    { title: "单买价(元)", dataIndex: "singlePrice", width: 100 },
    {
      title: "SKU 文件名",
      dataIndex: "imageFileName",
      width: 140,
      ellipsis: true,
      render: (v?: string) =>
        v ? (
          <Tag color="cyan" size="small">
            {v}
          </Tag>
        ) : (
          <Text type="danger">缺失</Text>
        ),
    },
    {
      title: "规格",
      dataIndex: "specCode",
      width: 110,
      render: (v?: string) => v || <Text type="tertiary">-</Text>,
    },
  ];

  return (
    <div>
      {/* 顶部步骤指示器 */}
      <Card className="dashboard-card">
        <Steps type="basic" current={currentStep} size="small">
          <Steps.Step title="登录" description="拼多多商家后台" />
          <Steps.Step title="搜索链接" description="商机/搜索页地址" />
          <Steps.Step title="商品 Excel" description="导入 SKU 行" />
          <Steps.Step title="重复创建次数" description="整个流程重复多少次" />
          <Steps.Step title="开始创建" description="自动填表 + 提交上架" />
        </Steps>
      </Card>

      {/* ① 登录 */}
      <Card
        className="dashboard-card"
        title={<Title heading={5}>① 用户登录</Title>}
      >
        <Space>
          <Text>当前登录态：{logged ? "✅ 已登录（缓存）" : "❌ 未登录"}</Text>
          {logged && userName && (
            <Tag color="cyan" size="large">
              👤 {userName}
            </Tag>
          )}
          <Button
            type="primary"
            theme={logged ? "light" : "solid"}
            onClick={handleLogin}
            loading={loginLoading}
          >
            {logged ? "重新登录" : "立即登录"}
          </Button>
        </Space>
      </Card>

      {/* ② 搜索链接 + 第几个商品 */}
      <Card
        className="dashboard-card"
        title={<Title heading={5}>② 输入搜索链接</Title>}
      >
        <Paragraph type="tertiary">
          填写「商机/搜索页」链接，应用会先打开此页面作为操作上下文。
          可在右侧设置使用搜索结果列表中的<strong>第几个商品</strong>
          「发布同款」（默认第 1 个）。
        </Paragraph>
        <Space style={{ width: "100%" }} align="center">
          <Input
            value={searchUrl}
            onChange={setSearchUrl}
            placeholder="https://mms.pinduoduo.com/sycm/..."
            disabled={!logged}
            style={{ width: 520 }}
          />
          <Text>用第</Text>
          <InputNumber
            value={productIndex}
            onChange={(v) => setProductIndex(typeof v === "number" ? v : 1)}
            min={1}
            max={50}
            step={1}
            style={{ width: 90 }}
            disabled={!logged}
          />
          <Text>个商品</Text>
          <Text type="tertiary">（按列表顺序，1 = 第一个）</Text>
        </Space>
      </Card>

      {/* ③ 商品 SKU Excel */}
      <Card
        className="dashboard-card"
        title={<Title heading={5}>③ 上传商品 Excel</Title>}
        headerExtraContent={
          <Tag color="blue">已识别 {productRows.length} 条 SKU</Tag>
        }
      >
        <Banner
          type="info"
          description="Excel 表头需包含：SKU / 库存 / 拼单价(元) / 单买价(元) / 规格 / SKU文件名称。最后一列『SKU文件名称』必须是已上传到拼多多『图片空间』的文件名（应用会按此名搜索并选第一张）。"
          style={{ marginBottom: 12 }}
          closeIcon={null}
        />
        <Space style={{ marginBottom: 8 }}>
          <Button onClick={handlePickExcel} disabled={!logged}>
            选择 Excel（.xlsx / .xls）
          </Button>
          {excelPath && <Text type="tertiary">{excelPath}</Text>}
        </Space>

        {excelErrors.length > 0 && (
          <Banner
            type="warning"
            description={
              <div style={{ maxHeight: 120, overflow: "auto" }}>
                {excelErrors.slice(0, 10).map((e, i) => (
                  <div key={i}>
                    第 {e.rowIndex} 行 [{e.field}]：{e.message}
                  </div>
                ))}
                {excelErrors.length > 10 && (
                  <div>... 还有 {excelErrors.length - 10} 条</div>
                )}
              </div>
            }
            style={{ marginBottom: 12 }}
            closeIcon={null}
          />
        )}

        {productRows.length > 0 && (
          <Table
            columns={columns as never}
            dataSource={productRows.map((r, i) => ({ ...r, key: i }))}
            pagination={{ pageSize: 8 }}
            size="small"
          />
        )}
      </Card>

      {/* ④ 重复创建次数 */}
      <Card
        className="dashboard-card"
        title={<Title heading={5}>④ 重复创建次数</Title>}
      >
        <Space>
          <Text>整个流程重复执行</Text>
          <InputNumber
            value={timesPerProduct}
            onChange={(v) => setTimesPerProduct(typeof v === "number" ? v : 1)}
            min={1}
            max={100}
            style={{ width: 120 }}
            disabled={!logged}
          />
          <Text>次</Text>
          <Text type="tertiary">
            预计执行：从『打开搜索链接 → 发布同款 → 填表 → 提交』完整一轮 ×{" "}
            <strong>{timesPerProduct}</strong> 次 ={" "}
            <strong>{timesPerProduct}</strong> 个商品
          </Text>
        </Space>
      </Card>

      {/* ⑤ 开始创建 */}
      <Card
        className="dashboard-card"
        title={<Title heading={5}>⑤ 开始创建</Title>}
      >
        <Banner
          type="info"
          description="开始后会自动：打开搜索链接 → 点击第一个商品『发布同款』 → 关闭弹窗 → 在发布页填充 SKU 行（款式 / 库存 / 拼单价 / 单买价 / 规格图 / 规格编码）。"
          style={{ marginBottom: 12 }}
          closeIcon={null}
        />
        <Space style={{ marginBottom: 12 }}>
          <Text>提交后自动上架：</Text>
          <Switch
            checked={autoSubmit}
            onChange={setAutoSubmit}
            disabled={progress.running}
          />
          <Text type="tertiary">
            {autoSubmit
              ? "✅ 填表完成会自动点击『提交并上架』"
              : "⚠️ 填表完成停在编辑页，由人工点击『提交并上架』"}
          </Text>
        </Space>
        <Space>
          <Button
            type="primary"
            theme="solid"
            onClick={handleStart}
            loading={progress.running}
            disabled={currentStep < 4}
          >
            开始创建
          </Button>
          <Button
            type="danger"
            onClick={handleStop}
            disabled={!progress.running}
          >
            中止
          </Button>
          <Button
            type="warning"
            onClick={handleRetrySpecs}
            disabled={progress.running || productRows.length === 0}
          >
            🔁 重试规格（调试用）
          </Button>
          <Text>
            进度：{progress.finished} / {progress.total}
          </Text>
          <Tag color="green">成功 {progress.success}</Tag>
          <Tag color="red">失败 {progress.failed}</Tag>
          <Tag color="purple">阻塞 {progress.blocked}</Tag>
        </Space>
        <Progress
          percent={percent}
          stroke="var(--semi-color-success)"
          style={{ marginTop: 12 }}
          showInfo
        />
        {progress.message && (
          <Paragraph type="tertiary" style={{ marginTop: 8 }}>
            {progress.message}
            {progress.currentSku && (
              <Text type="tertiary"> · 当前：{progress.currentSku}</Text>
            )}
          </Paragraph>
        )}
      </Card>
    </div>
  );
};

export default Dashboard;
