import { useEffect, useState } from 'react';
import { Card, Form, Button, Toast, Typography } from '@douyinfe/semi-ui';
import type { AppConfig } from '../../../shared/types';

const { Title, Paragraph } = Typography;

/** 配置页：Webhook、重试次数、间隔、headless 模式 */
const Settings = () => {
  const [cfg, setCfg] = useState<AppConfig | null>(null);

  useEffect(() => {
    window.api.getConfig().then(setCfg);
  }, []);

  if (!cfg) return <div>加载中...</div>;

  const handleSave = async (values: AppConfig) => {
    const next = await window.api.setConfig(values);
    setCfg(next);
    Toast.success('已保存');
  };

  return (
    <Card title={<Title heading={5}>系统配置</Title>}>
      <Paragraph type="tertiary">
        Webhook 用于在出现验证码 / 风控 / 连续失败时通知人工介入；间隔与重试次数影响风控规避效果。
      </Paragraph>
      <Form<AppConfig> initValues={cfg} onSubmit={handleSave} labelPosition="left" labelWidth={140}>
        <Form.Input
          field="webhookUrl"
          label="飞书/钉钉 Webhook"
          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
        />
        <Form.InputNumber field="maxRetries" label="单商品最大重试" min={1} max={10} />
        <Form.InputNumber field="intervalMs" label="商品间隔（ms）" min={2000} step={1000} />
        <Form.Switch field="headless" label="无头模式（仅调试）" />
        <Button htmlType="submit" type="primary" theme="solid" style={{ marginTop: 16 }}>
          保存
        </Button>
      </Form>
    </Card>
  );
};

export default Settings;
