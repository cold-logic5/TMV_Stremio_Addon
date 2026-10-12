#!/usr/bin/env bash
# One-shot setup for Ubuntu on Oracle Cloud (works on ARM Ampere and AMD Micro).
# Run on the VM as the default 'ubuntu' user:
#   curl -fsSL https://raw.githubusercontent.com/cold-logic5/TMV_Stremio_Addon/main/deploy/setup-oracle.sh -o setup.sh
#   bash setup.sh YOUR_DOMAIN
set -euo pipefail

DOMAIN="${1:-}"
REPO_URL="https://github.com/cold-logic5/TMV_Stremio_Addon.git"
APP_DIR="$HOME/TMV_Stremio_Addon"

if [ -z "$DOMAIN" ]; then
  echo "Usage: bash setup.sh <domain>   (e.g. inmax.duckdns.org or 1-2-3-4.sslip.io)"
  exit 1
fi

echo "==> Installing system packages"
sudo apt-get update -y
sudo apt-get install -y git curl debian-keyring debian-archive-keyring apt-transport-https gpg

echo "==> Installing Node.js 20"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing PM2"
sudo npm install -g pm2

echo "==> Installing Caddy"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -y
sudo apt-get install -y caddy

echo "==> Cloning and building the addon"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci
npm run build

echo "==> Starting with PM2 (auto-restart on reboot)"
pm2 start ecosystem.config.js
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"

echo "==> Configuring Caddy for $DOMAIN"
sed "s/YOUR_DOMAIN/$DOMAIN/" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl restart caddy

echo "==> Opening ports 80/443 in the Ubuntu firewall"
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save

echo
echo "Done! Addon URL:  https://$DOMAIN/manifest.json"
echo "(Also make sure ports 80 and 443 are open in the Oracle VCN Security List.)"
