#!/bin/sh
# Deploys new commits from GitHub: fetch, and when main has moved (or the app isn't
# running), reset to it and rebuild. Run by the chords-update timer, or by hand with sudo.
# The image build runs the tests first; if they fail, the running version stays up.
set -eu
cd "$(dirname "$0")/.."
git() { command git -c safe.directory="$PWD" "$@"; }

exec 9>/tmp/chords-update.lock
flock -n 9 || exit 0

git fetch --quiet origin main
here=$(git rev-parse HEAD)
there=$(git rev-parse origin/main)
running=$(docker compose ps -q --status running chords 2>/dev/null || true)
[ "$here" = "$there" ] && [ -n "$running" ] && exit 0

echo "deploying $(git rev-parse --short "$there") (was $(git rev-parse --short "$here"))"
git reset --hard --quiet origin/main
COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "deployed $(git rev-parse --short HEAD)"
