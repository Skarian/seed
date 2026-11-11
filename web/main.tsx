import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { AppRecovery } from './app-recovery.js';
import { listenForClientFailures } from './client-failure.js';
import './app/app.css';

listenForClientFailures();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRecovery><App /></AppRecovery>
  </React.StrictMode>,
);
