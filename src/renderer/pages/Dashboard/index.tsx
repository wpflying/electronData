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

  // ② 搜索链接
  const [searchUrl, setSearchUrl] = useState("");

  // ③ 商品 Excel
  const [excelPath, setExcelPath] = useState("");
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [excelErrors, setExcelErrors] = useState<ValidationError[]>([]);

  // ④ 创建次数
  const [timesPerProduct, setTimesPerProduct] = useState<number>(1);

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
    window.api.isLoggedIn().then(setLogged);
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
      productRows,
      timesPerProduct,
    });
  };

  const handleStop = async () => {
    await window.api.stopCreate();
  };

  const percent =
    progress.total === 0
      ? 0
      : Math.round((progress.finished / progress.total) * 100);

  // SKU 表格列定义
  const columns = [
    { title: "SKU", dataIndex: "sku", width: 280, ellipsis: true },
    { title: "库存", dataIndex: "stock", width: 100 },
    { title: "拼单价(元)", dataIndex: "groupPrice", width: 110 },
    { title: "单买价(元)", dataIndex: "singlePrice", width: 110 },
    {
      title: "预览图",
      dataIndex: "previewImage",
      width: 80,
      render: (v?: string) => {
        if (!v) return <Text type="tertiary">-</Text>;
        const isUrl = /^https?:\/\//i.test(v);
        return isUrl ? (
          <img
            src={v}
            alt="preview"
            style={{
              width: 36,
              height: 36,
              objectFit: "cover",
              borderRadius: 4,
            }}
          />
        ) : (
          <Text type="tertiary" ellipsis style={{ maxWidth: 60 }}>
            本地图
          </Text>
        );
      },
    },
    {
      title: "规格",
      dataIndex: "specCode",
      width: 120,
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
          <Steps.Step title="创建次数" description="每个商品创建几次" />
          <Steps.Step title="开始创建" description="自动填充规格与库存" />
        </Steps>
      </Card>

      {/* ① 登录 */}
      <Card
        className="dashboard-card"
        title={<Title heading={5}>① 用户登录</Title>}
      >
        <Space>
          <Text>当前登录态：{logged ? "✅ 已登录（缓存）" : "❌ 未登录"}</Text>
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

      {/* ② 搜索链接 */}
      <Card
        className="dashboard-card"
        title={<Title heading={5}>② 输入搜索链接</Title>}
      >
        <Paragraph type="tertiary">
          填写「商机/搜索页」链接，应用会先打开此页面作为操作上下文。
        </Paragraph>
        <Input
          value={searchUrl}
          onChange={setSearchUrl}
          placeholder="https://mms.pinduoduo.com/sycm/..."
          disabled={!logged}
        />
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
          description="Excel 表头需包含：SKU / 库存 / 拼单价(元) / 单买价(元) / 预览图 / 规格。每行将被填入发布页『规格与库存』模块。"
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

      {/* ④ 创建次数 */}
      <Card
        className="dashboard-card"
        title={<Title heading={5}>④ 输入创建次数</Title>}
      >
        <Space>
          <Text>每个 SKU 创建</Text>
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
            预计执行：{productRows.length} 条 × {timesPerProduct} 次 ={" "}
            <strong>{productRows.length * timesPerProduct}</strong> 个任务
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
