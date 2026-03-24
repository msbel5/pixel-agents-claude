/**
 * WebSocket Adapter — connects to the OpenClaw Pixel Agents plugin
 * backend and dispatches agent events as window MessageEvents,
 * matching the same format that useExtensionMessages.ts expects.
 */

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

let ws: WebSocket | null = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

function dispatch(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = getWsUrl();
  console.log(`[WS] Connecting to ${url}...`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS] Connected');
    reconnectDelay = RECONNECT_DELAY_MS;
    // Tell server we're ready
    ws?.send(JSON.stringify({ type: 'webviewReady' }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);
      // Dispatch as window message event — useExtensionMessages picks it up
      dispatch(data);
    } catch {
      console.warn('[WS] Failed to parse message:', event.data);
    }
  };

  ws.onclose = () => {
    console.log(`[WS] Disconnected. Reconnecting in ${reconnectDelay}ms...`);
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    connect();
  }, reconnectDelay);
}

/** Initialize the WebSocket connection to the plugin backend */
export function initWebSocket(): void {
  connect();
}

/** Send a message to the plugin backend (e.g., focusAgent) */
export function sendToBackend(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    console.log('[WS] Not connected, message dropped:', msg);
  }
}
