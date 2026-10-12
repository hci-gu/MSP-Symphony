#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if ! docker info >/dev/null 2>&1; then
  echo 'Start Docker Desktop, then run this command again.' >&2
  exit 1
fi
docker start msp-symphony-db msp-symphony-wildfly
cd "$root/frontend"
printf 'MARELD API: %s\n' "${MARELD_API_URL:-$(node -p "require('./src/app/features/mareld-shared/run-config.json').defaultApiTarget")}"
export SYMPHONY_API_URL="${SYMPHONY_API_URL:-http://127.0.0.1:8080}"
exec ./node_modules/.bin/ng serve --host 127.0.0.1 --port 4200 --ssl=false --proxy-config proxy.conf.js
