import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
};

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

function setStaticHeaders(res, ext) {
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-store');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
}

function resolveUiPath(basePath, requestPath) {
  const relPath = requestPath.slice(basePath.length).replace(/^\/+/, '');
  const normalizedRel = relPath === '' ? 'index.html' : relPath;
  const targetPath = path.resolve(UI_DIR, normalizedRel);
  if (!targetPath.startsWith(UI_DIR)) return null;
  return targetPath;
}

function writeSseMessage(res, message) {
  res.write(`data: ${JSON.stringify(message)}\n\n`);
}

export function createDashboardHttpHandler({ basePath, state, logger }) {
  return async function dashboardHttpHandler(req, res) {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end();
      return true;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    if (pathname === basePath) {
      res.statusCode = 302;
      res.setHeader('Location', `${basePath}/`);
      res.end();
      return true;
    }

    if (pathname === `${basePath}/api/bootstrap`) {
      sendJson(res, 200, state.getBootstrap());
      return true;
    }

    if (pathname === `${basePath}/api/snapshot`) {
      sendJson(res, 200, state.getSnapshot());
      return true;
    }

    if (pathname === `${basePath}/api/events`) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write('retry: 2000\n\n');

      const unsubscribe = state.subscribe((message) => {
        try {
          writeSseMessage(res, message);
        } catch (error) {
          logger.warn?.(
            `[pixel-agents] SSE write failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });

      const keepAlive = setInterval(() => {
        try {
          res.write(': keep-alive\n\n');
        } catch {}
      }, 20000);
      keepAlive.unref?.();

      req.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      req.on('error', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });

      return true;
    }

    if (!pathname.startsWith(`${basePath}/`)) {
      return false;
    }

    if (!fs.existsSync(UI_DIR)) {
      sendText(
        res,
        503,
        'Pixel Agents dashboard assets are missing. Run `npm run build:openclaw-plugin` first.',
      );
      return true;
    }

    const filePath = resolveUiPath(basePath, pathname);
    if (!filePath) {
      sendText(res, 400, 'Invalid dashboard path.');
      return true;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      sendText(res, 404, 'Dashboard asset not found.');
      return true;
    }

    const ext = path.extname(filePath).toLowerCase();
    setStaticHeaders(res, ext);
    if (method === 'HEAD') {
      res.end();
      return true;
    }

    res.end(fs.readFileSync(filePath));
    return true;
  };
}
