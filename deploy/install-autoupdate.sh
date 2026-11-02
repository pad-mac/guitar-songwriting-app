#!/bin/sh
# Installs a systemd timer that runs deploy/update.sh every minute. Run once with sudo.
set -eu
dir=$(cd "$(dirname "$0")/.." && pwd)

cat > /etc/systemd/system/chords-update.service <<UNIT
[Unit]
Description=Chords: deploy new commits from GitHub
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh $dir/deploy/update.sh
UNIT

cat > /etc/systemd/system/chords-update.timer <<UNIT
[Unit]
Description=Chords: check GitHub for new commits every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now chords-update.timer
systemctl start chords-update.service
echo "Timer on. Log: journalctl -u chords-update -f"
