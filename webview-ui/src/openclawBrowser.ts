import { isBrowserRuntime } from './runtime.js';

interface OpenClawBootstrap {
  kind: string;
  mode: string;
  readOnly: boolean;
  snapshotUrl: string;
  eventsUrl: string;
}

interface OpenClawSnapshot {
  generatedAt: number;
  messages: unknown[];
}

let bootstrap: OpenClawBootstrap | null = null;
let activeSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let stopped = false;

function dispatchMessage(message: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
}

function dispatchMessages(messages: unknown[]): void {
  for (const message of messages) {
    dispatchMessage(message);
  }
}

async function loadSnapshot(): Promise<void> {
  if (!bootstrap) return;
  const res = await fetch(bootstrap.snapshotUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Snapshot request failed with ${res.status.toString()}`);
  }
  const payload = (await res.json()) as OpenClawSnapshot;
  if (Array.isArray(payload.messages)) {
    dispatchMessages(payload.messages);
  }
}

function clearReconnectTimer(): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

async function reconnect(): Promise<void> {
  if (!bootstrap || stopped) return;
  try {
    await loadSnapshot();
    connectEventSource();
    reconnectAttempt = 0;
  } catch (error) {
    console.warn('[OpenClawBrowser] Reconnect failed:', error);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer || stopped) return;
  const delayMs = Math.min(5000, 500 * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void reconnect();
  }, delayMs);
}

function connectEventSource(): void {
  if (!bootstrap || stopped) return;
  if (activeSource) {
    activeSource.close();
    activeSource = null;
  }

  const source = new EventSource(bootstrap.eventsUrl);
  activeSource = source;

  source.onmessage = (event) => {
    if (!event.data) return;
    try {
      dispatchMessage(JSON.parse(event.data));
    } catch (error) {
      console.warn('[OpenClawBrowser] Failed to parse SSE payload:', error);
    }
  };

  source.onerror = () => {
    if (activeSource === source) {
      activeSource.close();
      activeSource = null;
    }
    scheduleReconnect();
  };
}

async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (error) {
    console.warn('[OpenClawBrowser] Service worker registration failed:', error);
  }
}

export async function initOpenClawBrowser(): Promise<void> {
  if (!isBrowserRuntime) return;
  try {
    const res = await fetch('./api/bootstrap', { cache: 'no-store' });
    if (!res.ok) return;
    const payload = (await res.json()) as OpenClawBootstrap;
    if (payload.kind !== 'openclaw.pixel-agents') return;
    bootstrap = payload;
    document.title = 'Pixel Agents Dashboard';
    await registerServiceWorker();
  } catch {
    bootstrap = null;
  }
}

export function isOpenClawBrowserRuntime(): boolean {
  return bootstrap?.mode === 'live';
}

export function isOpenClawReadOnlyRuntime(): boolean {
  return Boolean(bootstrap?.readOnly);
}

export async function startOpenClawBrowserStream(): Promise<() => void> {
  if (!bootstrap) return () => {};
  stopped = false;
  clearReconnectTimer();
  reconnectAttempt = 0;
  await loadSnapshot();
  connectEventSource();
  return () => {
    stopped = true;
    clearReconnectTimer();
    if (activeSource) {
      activeSource.close();
      activeSource = null;
    }
  };
}
