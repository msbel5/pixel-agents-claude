/**
 * Web Server — serves the Pixel Agents UI and provides WebSocket
 * for real-time agent status updates. Runs on a dedicated port
 * so it's accessible from both the Pi's local browser and tablets
 * on the same network.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import type { AgentEvent } from './agentTracker.js';

// ── Types ────────────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// ── Web Server ───────────────────────────────────────────────────────────────

export class PixelAgentsWebServer {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private staticDir: string;
  private port: number;

  constructor(port: number, staticDir: string) {
    this.port = port;
    this.staticDir = staticDir;

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[PixelAgents] WebSocket client connected (${this.clients.size} total)`);

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[PixelAgents] WebSocket client disconnected (${this.clients.size} total)`);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleClientMessage(ws, msg);
        } catch {
          /* ignore malformed */
        }
      });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        const addresses = getLocalIPs();
        console.log(`[PixelAgents] Web UI available at:`);
        console.log(`  Local:   http://localhost:${this.port}`);
        for (const addr of addresses) {
          console.log(`  Network: http://${addr}:${this.port}`);
        }
        console.log(`  (Open on your tablet or Pi browser)`);
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): void {
    for (const ws of this.clients) {
      ws.close();
    }
    this.clients.clear();
    this.wss.close();
    this.server.close();
  }

  /** Broadcast an agent event to all connected WebSocket clients */
  broadcast(event: AgentEvent): void {
    const data = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(data);
      }
    }
  }

  getPort(): number {
    return this.port;
  }

  private handleClientMessage(_ws: WebSocket, msg: Record<string, unknown>): void {
    // Handle messages from the web UI (e.g., focusAgent, closeAgent)
    // In standalone mode these are logged but not acted upon since
    // there's no VS Code terminal to focus
    if (msg.type === 'webviewReady') {
      console.log('[PixelAgents] Web UI client ready');
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    let filePath = path.join(this.staticDir, url.pathname === '/' ? 'index.html' : url.pathname);

    // Security: prevent directory traversal
    if (!filePath.startsWith(this.staticDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Try exact file, then try with .html extension
    if (!fs.existsSync(filePath)) {
      // SPA fallback: serve index.html for non-file routes
      const ext = path.extname(filePath);
      if (!ext) {
        filePath = path.join(this.staticDir, 'index.html');
      }
    }

    try {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  return addresses;
}
