#!/usr/bin/env bash
# RatAvert Pi installer — sets the client up as a systemd service so it
# starts automatically on boot and restarts itself if it ever crashes.
#
# Usage (run this from inside the pi/ folder, on the Raspberry Pi itself):
#   bash install.sh --device-key YOUR_DEVICE_KEY --backend https://your-backend-url
#
# Or just run `bash install.sh` with no arguments and it'll ask you.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/ratavert-pi"
DEVICE_KEY_ARG=""
BACKEND_URL_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-key) DEVICE_KEY_ARG="$2"; shift 2 ;;
    --backend)    BACKEND_URL_ARG="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "$DEVICE_KEY_ARG" ]]; then
  read -rp "Paste your DEVICE_KEY (from the backend's .env / dashboard env vars): " DEVICE_KEY_ARG
fi
if [[ -z "$BACKEND_URL_ARG" ]]; then
  read -rp "Backend URL (e.g. https://your-backend.up.railway.app): " BACKEND_URL_ARG
fi
if [[ -z "$DEVICE_KEY_ARG" || -z "$BACKEND_URL_ARG" ]]; then
  echo "Both a device key and backend URL are required. Aborting."
  exit 1
fi

echo "==> Installing Python dependencies..."
if ! pip3 install --quiet requests 2>/dev/null; then
  # Newer Raspberry Pi OS (Bookworm+) blocks system-wide pip installs by
  # default (PEP 668) — this flag is the standard, safe workaround here
  # since we're not touching any OS-managed packages.
  pip3 install --quiet --break-system-packages requests
fi

echo "==> Copying client files to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/ratavert_client_example.py" "$INSTALL_DIR/"

echo "==> Writing $INSTALL_DIR/.env..."
cat > "$INSTALL_DIR/.env" <<EOF
DEVICE_KEY=$DEVICE_KEY_ARG
BACKEND_URL=$BACKEND_URL_ARG
EOF
chmod 600 "$INSTALL_DIR/.env"

echo "==> Installing systemd service (needs sudo)..."
sed -e "s|__PI_USER__|$USER|g" -e "s|__PI_HOME__|$HOME|g" "$SCRIPT_DIR/ratavert.service" | sudo tee /etc/systemd/system/ratavert.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable ratavert
sudo systemctl restart ratavert

sleep 2
echo ""
echo "==> Status:"
sudo systemctl status ratavert --no-pager -l | head -12

echo ""
echo "✅ Installed. The RatAvert client now starts automatically on every boot"
echo "   and restarts itself if it ever crashes."
echo ""
echo "Useful commands:"
echo "  sudo systemctl status ratavert     # check if it's running"
echo "  journalctl -u ratavert -f          # watch live logs"
echo "  sudo systemctl restart ratavert    # restart it (e.g. after editing the script)"
echo "  sudo systemctl stop ratavert       # stop it"
echo ""
echo "To wire in your real camera/YOLOv8/GPIO code, edit:"
echo "  $INSTALL_DIR/ratavert_client_example.py"
echo "then run: sudo systemctl restart ratavert"
