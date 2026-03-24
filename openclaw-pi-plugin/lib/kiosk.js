import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { DASHBOARD_BASE_PATH, DEFAULT_GATEWAY_PORT } from './constants.js';

const DESKTOP_ENTRY_NAME = 'openclaw-pixel-agents.desktop';
const BROWSER_CANDIDATES = ['chromium-browser', 'chromium', 'google-chrome', 'google-chrome-stable'];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function resolveGatewayPort(config) {
  const maybePort = config?.gateway?.port;
  return typeof maybePort === 'number' && Number.isFinite(maybePort) ? maybePort : DEFAULT_GATEWAY_PORT;
}

function resolveDashboardUrl(config, origin) {
  if (origin) {
    return new URL(`${DASHBOARD_BASE_PATH}/`, origin).toString();
  }
  return `http://127.0.0.1:${resolveGatewayPort(config)}${DASHBOARD_BASE_PATH}/`;
}

function resolveDesktopEntryPath(customDir) {
  const autostartDir =
    customDir || path.join(os.homedir(), '.config', 'autostart');
  return path.join(autostartDir, DESKTOP_ENTRY_NAME);
}

function findBrowserBinary(explicitBrowser) {
  if (explicitBrowser) return explicitBrowser;
  for (const candidate of BROWSER_CANDIDATES) {
    const result = spawnSync('sh', ['-lc', `command -v ${shellQuote(candidate)}`], {
      encoding: 'utf8',
    });
    const resolved = result.stdout?.trim();
    if (result.status === 0 && resolved) return resolved;
  }
  throw new Error(
    `No supported Chromium browser found. Tried: ${BROWSER_CANDIDATES.join(', ')}`,
  );
}

function buildBrowserArgs(url) {
  return [
    '--kiosk',
    '--app=' + url,
    '--check-for-update-interval=31536000',
    '--disable-session-crashed-bubble',
    '--no-first-run',
  ];
}

function writeDesktopEntry({ browser, desktopEntryPath, url }) {
  const browserArgs = buildBrowserArgs(url).map(shellQuote).join(' ');
  const execLine = `sh -lc ${shellQuote(
    `${shellQuote(browser)} ${browserArgs} >/tmp/openclaw-pixel-agents-kiosk.log 2>&1`,
  )}`;
  const contents = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=OpenClaw Pixel Agents',
    'Comment=OpenClaw Pixel Agents kiosk dashboard',
    `Exec=${execLine}`,
    'Terminal=false',
    'Categories=Utility;',
    'X-GNOME-Autostart-enabled=true',
  ].join('\n');

  fs.mkdirSync(path.dirname(desktopEntryPath), { recursive: true });
  fs.writeFileSync(desktopEntryPath, `${contents}\n`, 'utf8');
}

function launchBrowser(browser, url) {
  const child = spawn(browser, buildBrowserArgs(url), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export function registerPixelAgentsCli({ api, program, config }) {
  const root = program
    .command('pixel-agents')
    .description('Pixel Agents dashboard utilities for OpenClaw.');

  root
    .command('kiosk-open')
    .description('Launch the Pixel Agents dashboard in Chromium kiosk mode.')
    .option('--browser <path>', 'Browser binary override')
    .option('--origin <origin>', 'Gateway origin override, e.g. http://127.0.0.1:18789')
    .action(async (options) => {
      const browser = findBrowserBinary(options.browser);
      const url = resolveDashboardUrl(config, options.origin);
      launchBrowser(browser, url);
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: 'kiosk-open',
            browser,
            url,
          },
          null,
          2,
        ),
      );
    });

  root
    .command('kiosk-install')
    .description('Install a desktop-session autostart entry for Chromium kiosk mode.')
    .option('--browser <path>', 'Browser binary override')
    .option('--origin <origin>', 'Gateway origin override, e.g. http://127.0.0.1:18789')
    .option('--autostart-dir <path>', 'Autostart directory override')
    .action(async (options) => {
      const browser = findBrowserBinary(options.browser);
      const url = resolveDashboardUrl(config, options.origin);
      const desktopEntryPath = resolveDesktopEntryPath(options.autostartDir);
      writeDesktopEntry({
        browser,
        desktopEntryPath,
        url,
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: 'kiosk-install',
            browser,
            url,
            desktopEntryPath,
          },
          null,
          2,
        ),
      );
    });

  root
    .command('kiosk-remove')
    .description('Remove the desktop-session autostart entry for Chromium kiosk mode.')
    .option('--autostart-dir <path>', 'Autostart directory override')
    .action(async (options) => {
      const desktopEntryPath = resolveDesktopEntryPath(options.autostartDir);
      if (fs.existsSync(desktopEntryPath)) {
        fs.unlinkSync(desktopEntryPath);
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: 'kiosk-remove',
            desktopEntryPath,
          },
          null,
          2,
        ),
      );
    });

  root
    .command('url')
    .description('Print the local dashboard URL.')
    .option('--origin <origin>', 'Gateway origin override, e.g. http://127.0.0.1:18789')
    .action(async (options) => {
      console.log(resolveDashboardUrl(config, options.origin));
    });

  api.logger.info?.('[pixel-agents] CLI registered');
}
