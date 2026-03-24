/**
 * OpenClaw Pixel Agents — standalone browser entry point.
 *
 * 1. Loads assets via browserMock (existing pixel-agents code)
 * 2. Connects WebSocket to plugin backend for real-time agent events
 * 3. Renders the same pixel-art office UI
 */

import '@webview/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './OpenClawApp.tsx';
import { initWebSocket } from './wsAdapter.ts';

async function main() {
  // Load assets via browser mock (PNG decode + mock asset messages)
  const { initBrowserMock } = await import('@webview/browserMock.ts');
  await initBrowserMock();

  // Connect WebSocket for real-time agent events from OpenClaw
  initWebSocket();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main().catch(console.error);
