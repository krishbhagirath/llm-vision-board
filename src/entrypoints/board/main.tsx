import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import '@xyflow/react/dist/style.css';
import { BoardApp } from '@/features/workspaces/ui/BoardApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BoardApp />
  </React.StrictMode>,
);
