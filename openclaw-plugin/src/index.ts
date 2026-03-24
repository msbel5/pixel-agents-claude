/**
 * OpenClaw Pixel Agents Plugin
 *
 * Registers a web server that serves the Pixel Agents visualization UI.
 * Tracks agent activity by monitoring JSONL session files and broadcasts
 * updates via WebSocket to any connected browser (Pi screen or tablet).
 *
 * Usage:
 *   openclaw plugins install ./openclaw-pixel-agents
 *   # Then open http://<pi-ip>:18790 on your tablet
 */

import * as path from 'node:path';
import * as childProcess from 'node:child_process';

import { AgentTracker } from './agentTracker.js';
import { PixelAgentsWebServer } from './webServer.js';

// ── Plugin state ─────────────────────────────────────────────────────────────

let tracker: AgentTracker | null = null;
let webServer: PixelAgentsWebServer | null = null;

// ── Plugin Entry ─────────────────────────────────────────────────────────────

/**
 * OpenClaw plugin entry point.
 *
 * Since jiti loads this module directly, we use a default export
 * with the standard plugin shape. If `definePluginEntry` is available
 * from the SDK, use it; otherwise export a plain object that OpenClaw
 * can discover.
 */
const pluginEntry = {
  id: 'pixel-agents',
  name: 'Pixel Agents',
  description: 'Pixel art office visualization for your OpenClaw agents',

  register(api: PluginAPI) {
    const config = api.getConfig?.() ?? {};
    const port = (config.port as number) || 18790;
    const openBrowser = config.openBrowser !== false;

    // Resolve the UI static directory (built Vite output)
    const uiDir = path.resolve(import.meta.dirname ?? __dirname, '..', 'ui', 'dist');

    // Create the agent tracker
    tracker = new AgentTracker((event) => {
      webServer?.broadcast(event);
    });

    // Create and start web server
    webServer = new PixelAgentsWebServer(port, uiDir);

    // Register a gateway lifecycle hook to start/stop
    api.onGatewayReady?.(() => {
      tracker!.start();
      webServer!
        .start()
        .then(() => {
          if (openBrowser) {
            // On Pi with desktop, open chromium in kiosk mode
            tryOpenBrowser(`http://localhost:${port}`);
          }
        })
        .catch((err: unknown) => {
          console.error('[PixelAgents] Failed to start web server:', err);
        });
    });

    api.onGatewayShutdown?.(() => {
      tracker?.stop();
      webServer?.stop();
    });

    // Also register an agent tool so users can ask about pixel agents status
    api.registerTool?.({
      name: 'pixel_agents_status',
      description: 'Get the URL for the Pixel Agents visualization dashboard',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        return {
          content: [
            {
              type: 'text',
              text: `Pixel Agents visualization is running at http://localhost:${port}\nOpen this URL on any device on the same network to see your agents as pixel art characters.`,
            },
          ],
        };
      },
    });

    // Register an HTTP route on the gateway for discovery
    api.registerHttpRoute?.({
      path: '/pixel-agents',
      auth: 'gateway',
      match: 'exact',
      handler: async (_req: unknown, res: HTTPResponse) => {
        res.statusCode = 302;
        res.setHeader('Location', `http://localhost:${port}`);
        res.end();
        return true;
      },
    });

    console.log(`[PixelAgents] Plugin registered (port: ${port})`);
  },
};

export default pluginEntry;

// ── Browser launch helper ────────────────────────────────────────────────────

function tryOpenBrowser(url: string): void {
  // Try common Linux browsers (Raspberry Pi OS uses chromium)
  const browsers = [
    ['chromium-browser', ['--kiosk', '--noerrdialogs', '--disable-infobars', url]],
    ['chromium', ['--kiosk', '--noerrdialogs', '--disable-infobars', url]],
    ['firefox', [url]],
    ['xdg-open', [url]],
  ] as const;

  for (const [cmd, args] of browsers) {
    try {
      const proc = childProcess.spawn(cmd, [...args], {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();
      console.log(`[PixelAgents] Opened browser: ${cmd}`);
      return;
    } catch {
      // Try next
    }
  }
  console.log(`[PixelAgents] Could not auto-open browser. Open manually: ${url}`);
}

// ── Type stubs (avoid hard dependency on openclaw SDK) ───────────────────────

interface PluginAPI {
  getConfig?: () => Record<string, unknown>;
  onGatewayReady?: (cb: () => void) => void;
  onGatewayShutdown?: (cb: () => void) => void;
  registerTool?: (tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (
      id: string,
      params: Record<string, unknown>,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
    }>;
  }) => void;
  registerHttpRoute?: (route: {
    path: string;
    auth: string;
    match: string;
    handler: (req: unknown, res: HTTPResponse) => Promise<boolean>;
  }) => void;
}

interface HTTPResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(data?: string): void;
}
