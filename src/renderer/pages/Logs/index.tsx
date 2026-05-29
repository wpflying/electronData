import { useEffect, useRef, useState } from 'react';
import { Card, Typography, Button, Space } from '@douyinfe/semi-ui';

const { Title } = Typography;

/** 日志页：实时显示主进程推送的日志 */
const Logs = () => {
  const [lines, setLines] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = window.api.onLog((line) => {
      setLines((prev) => {
        // 仅保留最近 1000 行，避免内存膨胀
        const next = prev.length >= 1000 ? [...prev.slice(-999), line] : [...prev, line];
        return next;
      });
    });
    return off;
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <Card
      title={<Title heading={5}>运行日志</Title>}
      headerExtraContent={
        <Space>
          <Button onClick={() => setLines([])}>清空</Button>
        </Space>
      }
    >
      <div
        ref={boxRef}
        style={{
          height: 'calc(100vh - 220px)',
          overflowY: 'auto',
          background: '#1e1e1e',
          color: '#d4d4d4',
          fontFamily: 'Menlo, Consolas, monospace',
          fontSize: 12,
          padding: 12,
          borderRadius: 4,
          whiteSpace: 'pre-wrap',
        }}
      >
        {lines.length === 0 ? '暂无日志' : lines.join('\n')}
      </div>
    </Card>
  );
};

export default Logs;
