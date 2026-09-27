import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { SpicyProvider } from './spicy-mode.js';
import {AppRecovery} from './app-recovery.js';
import {listenForClientFailures} from './client-failure.js';
import './style.css';
import './job-ui.css';

listenForClientFailures();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRecovery><SpicyProvider>
      <App />
    </SpicyProvider></AppRecovery>
  </React.StrictMode>,
);
