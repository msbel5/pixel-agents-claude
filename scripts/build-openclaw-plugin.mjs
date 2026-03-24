import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const webviewDistDir = path.join(rootDir, 'dist', 'webview');
const pluginUiDir = path.join(rootDir, 'openclaw-pi-plugin', 'ui');

if (!fs.existsSync(webviewDistDir)) {
  throw new Error('Missing dist/webview. Run `npm run build:webview` first.');
}

fs.rmSync(pluginUiDir, { recursive: true, force: true });
fs.mkdirSync(pluginUiDir, { recursive: true });
fs.cpSync(webviewDistDir, pluginUiDir, { recursive: true });

console.log(`Copied ${webviewDistDir} -> ${pluginUiDir}`);
