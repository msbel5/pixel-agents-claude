/**
 * OpenClaw-adapted App wrapper.
 *
 * Renders the pixel-agents App with WebSocket-based agent events.
 * browserMock handles asset loading; wsAdapter handles live agent data.
 */

import { useEffect } from 'react';

import App from '@webview/App.tsx';

export default function OpenClawApp() {
  // Dispatch mock asset messages after the message listener registers
  useEffect(() => {
    void import('@webview/browserMock.ts').then(({ dispatchMockMessages }) =>
      dispatchMockMessages(),
    );
  }, []);

  return <App />;
}
