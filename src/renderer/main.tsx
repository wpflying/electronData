import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../preload/types';
import './styles/global.less';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
