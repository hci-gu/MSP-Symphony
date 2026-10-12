#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if ! docker info >/dev/null 2>&1; then
  echo 'Start Docker Desktop, then run this command again.' >&2
  exit 1
fi
docker start msp-symphony-db msp-symphony-wildfly
mkdir -p "$root/.local/symphony"
cat > "$root/.local/symphony/proxy.cjs" <<'JS'
module.exports = {
  '/mareld-api/**': { target: process.env.MARELD_API_URL || 'http://localhost:8000', changeOrigin: true, pathRewrite: {'^/mareld-api': ''}, timeout: 1810000, proxyTimeout: 1810000 },
  '/symphony-ws/service/**': { target: 'http://127.0.0.1:8080', secure: false, changeOrigin: true },
  '/socket/**': { target: 'http://127.0.0.1:8080', secure: false, ws: true, pathRewrite: {'^/socket': '/symphony-ws'} }
};
JS
cd "$root/frontend"
printf 'MARELD API: %s\n' "${MARELD_API_URL:-http://localhost:8000}"
exec ./node_modules/.bin/ng serve --host 127.0.0.1 --port 4200 --ssl=false --proxy-config ../.local/symphony/proxy.cjs
