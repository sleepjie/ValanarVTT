#!/bin/bash
# Sets the site up on a fresh Ubuntu server (22.04 or 24.04), with HTTPS, starting by itself after a reboot.
#
#   sudo bash deploy/setup-ubuntu.sh                      # address: <server-ip>.sslip.io (free, no domain needed)
#   sudo bash deploy/setup-ubuntu.sh table.example.com    # your own domain (point its DNS at this server first)
#   sudo bash deploy/setup-ubuntu.sh sslip                # back to the free <server-ip>.sslip.io address
# The domain is remembered (/etc/valanar.domain), so later runs without one keep it.
#
# Run it from the folder you uploaded or cloned. It copies the site to /opt/valanar/app; data lives in
# /opt/valanar/data (back that folder up). Running it again updates the code and keeps the data.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SRC/server/server.js" ] || { echo "Run this from the site's folder (the one with server/ in it)."; exit 1; }

IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
SSLIP="$(echo "$IP" | tr . -).sslip.io"
DOMAIN="${1:-$(cat /etc/valanar.domain 2>/dev/null || true)}"
DOMAIN="$(echo "$DOMAIN" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#/.*$##' -e 's/^www\.//')"
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = sslip ]; then DOMAIN="$SSLIP"; fi
echo "$DOMAIN" > /etc/valanar.domain
APP=/opt/valanar/app DATA=/opt/valanar/data ENVF=/etc/valanar.env

echo "== Installing Node.js, Caddy and the firewall"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw rsync
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -yq nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi

echo "== Copying the site to $APP"
id valanar >/dev/null 2>&1 || useradd --system --home /opt/valanar --shell /usr/sbin/nologin valanar
mkdir -p "$APP" "$DATA"
rsync -a --delete --exclude vtt-data --exclude .git --exclude 'tools/vips-dev-*' --exclude '/*.png' --exclude '*.psd' --exclude site.tgz "$SRC/" "$APP/"
# a vtt-data folder that came along (moving an existing site here): its contents go in once
if [ -d "$SRC/vtt-data" ] && [ -z "$(ls -A "$DATA" 2>/dev/null)" ]; then rsync -a "$SRC/vtt-data/" "$DATA/"; echo "   (copied your existing vtt-data in)"; fi
chown -R valanar:valanar /opt/valanar

if [ ! -f "$ENVF" ]; then
  echo
  read -r -p "Admin name [GM]: " NAME; NAME="${NAME:-GM}"
  while :; do read -r -s -p "Admin password (6+ characters): " PW; echo; [ "${#PW}" -ge 6 ] && break; echo "Too short."; done
  umask 077
  cat > "$ENVF" <<EOT
VTT_DATA=$DATA
VTT_HOST=127.0.0.1
VTT_PORT=8642
VTT_NO_LOCAL_LOGIN=1
VTT_ADMIN_NAME=$NAME
VTT_ADMIN_PASSWORD=$PW
EOT
fi

echo "== The service"
cat > /etc/systemd/system/valanar.service <<EOT
[Unit]
Description=World site and virtual tabletop
After=network.target

[Service]
User=valanar
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=/usr/bin/node server/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOT
systemctl daemon-reload
systemctl enable --now valanar
systemctl restart valanar

echo "== HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOT
$DOMAIN {
	encode gzip
	request_body {
		max_size 250MB
	}
	reverse_proxy 127.0.0.1:8642
}
EOT
# with a domain of your own, www.<domain> and the old sslip.io address send people on to it
if [ "$DOMAIN" != "$SSLIP" ]; then cat >> /etc/caddy/Caddyfile <<EOT
www.$DOMAIN, $SSLIP {
	redir https://$DOMAIN{uri} permanent
}
EOT
fi
systemctl reload caddy || systemctl restart caddy

ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo
echo "Done. Your site: https://$DOMAIN"
echo "Log in with the admin name and password you chose (they live in $ENVF; you can delete"
echo "the VTT_ADMIN_PASSWORD line after your first login, then: systemctl restart valanar)."
echo "Data: $DATA (back it up, or use Admin > Download a full backup)."
echo "Logs: journalctl -u valanar -f"
