#!/bin/sh
# One-time server setup: DuckDNS → this server, Docker, the app, automatic updates,
# HTTPS through Caddy (keeps any site already in the Caddyfile, e.g. the News Reader).
#
#   sudo sh deploy/setup-server.sh guitarwriter YOUR-DUCKDNS-TOKEN
#
# Safe to run again: steps that are already done are skipped.
set -eu
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
name=${1:?"First argument: the DuckDNS name, e.g. guitarwriter"}
token=${2:?"Second argument: your DuckDNS token (top of duckdns.org after logging in)"}
name=${name%.duckdns.org}
domain="$name.duckdns.org"
port=8081
dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$dir"
step() { printf '\n== %s\n' "$*"; }

step "DuckDNS: $domain → this server"
answer=$(curl -4 -fsS "https://www.duckdns.org/update?domains=$name&token=$token&ip=" || true)
if [ "$answer" != OK ]; then
  echo "DuckDNS answered '${answer:-nothing}'. Check the name and the token, then run this again."
  exit 1
fi
echo "server IP: $(curl -4 -fsS https://api.ipify.org || echo unknown)"

step "Docker"
if command -v docker >/dev/null 2>&1; then
  echo "already installed: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
fi
docker compose version

step "The app (the first build takes a few minutes)"
COMMIT=$(git -c safe.directory="$dir" rev-parse --short HEAD) docker compose up -d --build
i=0
until curl -fsS "127.0.0.1:$port/healthz"; do
  i=$((i + 1))
  [ $i -lt 30 ] || { echo "The app does not answer. Log: docker compose logs"; exit 1; }
  sleep 1
done
echo

step "Automatic updates from GitHub"
sh deploy/install-autoupdate.sh

step "Caddy (HTTPS)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq caddy
fi
cf=${CADDYFILE:-/etc/caddy/Caddyfile}
mkdir -p /etc/caddy
touch "$cf"
if grep -Eq "^[[:space:]]*$domain([[:space:],{]|$)" "$cf"; then
  echo "$domain is already in $cf"
else
  backup="$cf.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$cf" "$backup"
  # the lines that are not comments or blank
  content=$(grep -Ev '^[[:space:]]*(#|$)' "$cf" || true)
  first=$(printf '%s\n' "$content" | head -n 1)
  if [ -z "$content" ] || printf '%s' "$first" | grep -Eq '^:80([[:space:]]|\{|$)'; then
    # empty, or the example Caddy ships with: replace it
    : > "$cf"
  elif ! printf '%s\n' "$content" | grep -q '{'; then
    # one site written without braces (address, then its lines): add braces so a second site fits
    { printf '%s {\n' "$first"; printf '%s\n' "$content" | tail -n +2 | sed 's/^[[:space:]]*/\t/'; printf '}\n'; } > "$cf"
  fi
  printf '\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$domain" "$port" >> "$cf"
  if ! caddy validate --config "$cf" --adapter caddyfile >/dev/null 2>&1; then
    cp "$backup" "$cf"
    echo "The new Caddyfile did not validate, so the old one is back in place."
    caddy validate --config "$cf" --adapter caddyfile || true
    exit 1
  fi
  echo "Caddyfile now (the old one is in $backup):"
  cat "$cf"
fi
systemctl enable --now caddy >/dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy

step "Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  echo "opened ports 80 and 443"
else
  echo "no active ufw firewall, nothing to open"
fi

step "Done"
echo "Open https://$domain now and choose the password."
echo "(The first load can take a few seconds while Caddy gets the certificate.)"
