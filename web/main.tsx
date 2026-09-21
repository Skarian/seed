import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { SpicyProvider } from './spicy-mode.js';
import './style.css';
import './job-ui.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SpicyProvider>
      <App />
    </SpicyProvider>
  </React.StrictMode>,
);
