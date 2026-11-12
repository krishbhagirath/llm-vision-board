import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import { SidePanelApp } from '@/features/sidepanel/ui/SidePanelApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SidePanelApp />
  </React.StrictMode>,
);
