import { useState } from 'react';
import { Layout, Nav } from '@douyinfe/semi-ui';
import { IconHome, IconSetting, IconHistogram } from '@douyinfe/semi-icons';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Logs from './pages/Logs';

/** 顶层应用：Semi Layout + 侧边导航，通过本地 state 切换三个页面 */
type PageKey = 'dashboard' | 'settings' | 'logs';

const App = () => {
  const [active, setActive] = useState<PageKey>('dashboard');

  const renderPage = () => {
    switch (active) {
      case 'settings':
        return <Settings />;
      case 'logs':
        return <Logs />;
      case 'dashboard':
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout className="app-layout">
      <Layout.Header className="app-layout__header">
        <Nav
          mode="horizontal"
          selectedKeys={[active]}
          onSelect={({ itemKey }) => setActive(itemKey as PageKey)}
          items={[
            { itemKey: 'dashboard', text: '主控台', icon: <IconHome /> },
            { itemKey: 'logs', text: '日志', icon: <IconHistogram /> },
            { itemKey: 'settings', text: '配置', icon: <IconSetting /> },
          ]}
          header={{ text: '拼多多批量上架助手' }}
        />
      </Layout.Header>
      <Layout.Content className="app-layout__body">{renderPage()}</Layout.Content>
    </Layout>
  );
};

export default App;
