#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Pixel Agents — Raspberry Pi Setup Script
#
# Sets up the OpenClaw Pixel Agents plugin on a Raspberry Pi:
# 1. Installs the plugin into OpenClaw
# 2. Creates a systemd service to auto-launch the browser on boot
# 3. Configures chromium kiosk mode for the Pi's display
#
# Usage:
#   chmod +x setup-pi.sh
#   ./setup-pi.sh
# ──────────────────────────────────────────────────────────────────────────────

set -e

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PIXEL_AGENTS_PORT:-18790}"
SERVICE_NAME="pixel-agents-display"

echo "╔════════════════════════════════════════════╗"
echo "║  Pixel Agents — Raspberry Pi Setup         ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# ── Step 1: Install OpenClaw plugin ──────────────────────────────────────────
echo "→ Installing OpenClaw plugin..."
if command -v openclaw &> /dev/null; then
    openclaw plugins install "$PLUGIN_DIR" || {
        echo "  (Manual install: copy $PLUGIN_DIR to ~/.openclaw/extensions/pixel-agents/)"
    }
else
    echo "  ⚠ OpenClaw not found. Install it first: npm install -g openclaw@latest"
    echo "  Then run: openclaw plugins install $PLUGIN_DIR"
fi
echo ""

# ── Step 2: Build the UI ─────────────────────────────────────────────────────
echo "→ Building Pixel Agents UI..."
if [ -d "$PLUGIN_DIR/ui/node_modules" ]; then
    echo "  Dependencies already installed"
else
    cd "$PLUGIN_DIR/ui" && npm install
fi
cd "$PLUGIN_DIR/ui" && npm run build
echo "  ✓ UI built to $PLUGIN_DIR/ui/dist/"
echo ""

# ── Step 3: Create auto-launch systemd service ──────────────────────────────
echo "→ Creating systemd service for display auto-launch..."

DISPLAY_VAL="${DISPLAY:-:0}"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Pixel Agents Display (Chromium Kiosk)
After=graphical-session.target openclaw.service
Wants=graphical-session.target

[Service]
Type=simple
User=$(whoami)
Environment=DISPLAY=${DISPLAY_VAL}
Environment=XAUTHORITY=/home/$(whoami)/.Xauthority
ExecStartPre=/bin/sleep 5
ExecStart=/usr/bin/chromium-browser \\
    --kiosk \\
    --noerrdialogs \\
    --disable-infobars \\
    --disable-session-crashed-bubble \\
    --disable-features=TranslateUI \\
    --check-for-update-interval=31536000 \\
    --no-first-run \\
    http://localhost:${PORT}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=graphical-session.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
echo "  ✓ Service created: $SERVICE_NAME"
echo ""

# ── Step 4: Create desktop shortcut ─────────────────────────────────────────
DESKTOP_FILE="/home/$(whoami)/Desktop/pixel-agents.desktop"
if [ -d "/home/$(whoami)/Desktop" ]; then
    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=Pixel Agents
Comment=OpenClaw Agent Visualization
Exec=chromium-browser --app=http://localhost:${PORT}
Type=Application
Icon=utilities-terminal
Categories=Utility;
EOF
    chmod +x "$DESKTOP_FILE"
    echo "  ✓ Desktop shortcut created"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  Setup Complete!                            ║"
echo "╠════════════════════════════════════════════╣"
echo "║                                             ║"
echo "║  Pi Display:                                ║"
echo "║    http://localhost:${PORT}              ║"
echo "║                                             ║"
echo "║  Tablet / Other devices:                    ║"

# Show network IPs
for ip in $(hostname -I 2>/dev/null); do
    echo "║    http://${ip}:${PORT}"
done

echo "║                                             ║"
echo "║  Commands:                                  ║"
echo "║    Start display:                           ║"
echo "║      sudo systemctl start $SERVICE_NAME  ║"
echo "║    Stop display:                            ║"
echo "║      sudo systemctl stop $SERVICE_NAME   ║"
echo "║    View logs:                               ║"
echo "║      journalctl -u $SERVICE_NAME -f      ║"
echo "║                                             ║"
echo "╚════════════════════════════════════════════╝"
