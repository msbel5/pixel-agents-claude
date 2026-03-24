# Pixel Agents Dashboard

OpenClaw native plugin that serves a read-only Pixel Agents style dashboard at `/pixel-agents/`.

Use the repo root to build the web UI bundle:

```bash
npm run build:openclaw-plugin
openclaw plugins install ./openclaw-pi-plugin
openclaw gateway --port 18789 --bind lan --token CHANGE_ME
openclaw pixel-agents kiosk-install
```

Then open `http://<pi-ip>:18789/pixel-agents/` on the tablet.
