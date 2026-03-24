# Pixel Agents — OpenClaw Plugin

Pixel art office visualization for [OpenClaw](https://github.com/openclaw/openclaw) agents running on Raspberry Pi.
Watch your AI agents come to life as animated pixel-art characters on your Pi's screen or tablet.

Based on [pixel-agents](https://github.com/pablodelucca/pixel-agents) VS Code extension, adapted as a standalone OpenClaw plugin.

## What It Does

- **Visualizes OpenClaw agent activity** as pixel-art characters in a virtual office
- **Monitors JSONL session files** to track tool usage (Read, Write, Bash, etc.)
- **Shows real-time status**: active (typing/reading animation), waiting (green checkmark), permission needed (amber dots)
- **Sub-agent support**: Task/Agent tools spawn child characters
- **Runs on Pi's display**: Chromium kiosk mode, auto-launches on boot
- **Runs on tablet**: Android APK or any browser on the same network
- **Layout editor**: Customize your office with furniture, floors, walls

## Architecture

```
┌────────────────────────────────┐
│  Browser (Pi / Tablet / Phone) │
│  React + Canvas pixel-art UI   │
│  ← WebSocket (real-time) →     │
└──────────────┬─────────────────┘
               │ ws://pi-ip:18790
┌──────────────▼─────────────────┐
│  OpenClaw Plugin Backend       │
│  ├─ HTTP Server (static UI)    │
│  ├─ WebSocket Server           │
│  └─ AgentTracker               │
│     └─ JSONL File Watcher      │
│        ~/.claude/projects/...  │
└──────────────┬─────────────────┘
               │
┌──────────────▼─────────────────┐
│  OpenClaw Gateway              │
│  (running on Raspberry Pi 5)   │
└────────────────────────────────┘
```

## Quick Start

### 1. Install on Raspberry Pi

```bash
# Clone this repo on your Pi
git clone https://github.com/msbel5/pixel-agents-claude.git
cd pixel-agents-claude/openclaw-plugin

# Install dependencies and build UI
cd ui && npm install && npm run build && cd ..
npm install

# Install as OpenClaw plugin
openclaw plugins install .

# Or run the automated setup script
chmod +x scripts/setup-pi.sh
./scripts/setup-pi.sh
```

### 2. Access the Visualization

- **On Pi's screen**: Opens automatically in Chromium kiosk mode (if setup script was used)
- **On tablet/phone**: Open `http://<pi-ip>:18790` in your browser
- **Android APK**: Build and install the app from `android/` directory, enter your Pi's IP address

### 3. Configuration

Edit `~/.openclaw/config.yaml` (or use `openclaw config set`):

```yaml
plugins:
  entries:
    pixel-agents:
      enabled: true
      config:
        port: 18790          # Web UI port (default: 18790)
        openBrowser: true     # Auto-open browser on Pi (default: true)
```

## Android APK

The `android/` directory contains a minimal Android app (WebView wrapper) that:
- Connects to your Pi's Pixel Agents web UI
- Runs fullscreen in landscape mode
- Remembers the Pi's address
- Supports hardware-accelerated canvas rendering

### Building the APK

```bash
cd android
# Requires Android SDK / Android Studio
./gradlew assembleDebug
# APK at: app/build/outputs/apk/debug/app-debug.apk
```

Or import the `android/` folder into Android Studio and build from there.

## Development

### Plugin Backend

```bash
# The plugin source is in src/ — loaded by OpenClaw via jiti (no compile needed)
# Main files:
#   src/index.ts        — Plugin entry point
#   src/agentTracker.ts — JSONL file monitoring
#   src/webServer.ts    — HTTP + WebSocket server
```

### Web UI

```bash
cd ui
npm install
npm run dev    # Vite dev server with hot reload
npm run build  # Production build to ui/dist/
```

The UI reuses the pixel-agents webview code from `../../webview-ui/src/` with path aliases.
A WebSocket adapter (`src/wsAdapter.ts`) replaces VS Code's `postMessage` for real-time agent events.

## How It Works

1. **AgentTracker** scans `~/.claude/projects/` for active JSONL session files
2. Each file is monitored via `fs.watch` + polling fallback (reliable on Pi's SD card)
3. JSONL records are parsed: `assistant` (tool_use), `user` (tool_result), `system` (turn_duration), `progress` (sub-agents)
4. Events are broadcast to all connected WebSocket clients
5. The React UI receives events and animates characters accordingly:
   - New agent → character spawns with matrix effect
   - Tool use → character walks to desk, starts typing/reading animation
   - Turn complete → waiting bubble appears
   - Permission needed → amber dots bubble

## Files

```
openclaw-plugin/
├── openclaw.plugin.json    # Plugin manifest for OpenClaw
├── package.json            # Node package
├── tsconfig.json           # TypeScript config
├── README.md               # This file
├── src/
│   ├── index.ts            # Plugin entry (definePluginEntry)
│   ├── agentTracker.ts     # JSONL file monitoring + event emission
│   └── webServer.ts        # HTTP static server + WebSocket
├── ui/                     # Web UI (Vite + React)
│   ├── src/
│   │   ├── main.tsx        # Entry: loads assets + connects WebSocket
│   │   ├── OpenClawApp.tsx # App wrapper
│   │   └── wsAdapter.ts   # WebSocket ↔ window MessageEvent bridge
│   ├── index.html          # Mobile-optimized HTML shell
│   ├── vite.config.ts      # Vite config with asset pipeline
│   └── dist/               # Built output (served by plugin)
├── android/                # Android APK project
│   └── app/src/main/java/com/pixelagents/
│       └── MainActivity.java  # WebView wrapper
└── scripts/
    └── setup-pi.sh         # Automated Pi setup script
```

## License

MIT — Same as the original [pixel-agents](https://github.com/pablodelucca/pixel-agents) project.
