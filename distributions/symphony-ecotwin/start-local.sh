#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
# Starting named local services is opt-in; this launcher never selects a database implicitly.
if [[ -n "${SYMPHONY_DB_CONTAINER:-}" ]]; then docker start "$SYMPHONY_DB_CONTAINER"; fi
if [[ -n "${SYMPHONY_APP_CONTAINER:-}" ]]; then docker start "$SYMPHONY_APP_CONTAINER"; fi
export SYMPHONY_API_URL="${SYMPHONY_API_URL:-http://127.0.0.1:8080}"
cd "$root/frontend"
exec npm run start:ecotwin -- --host 127.0.0.1 --port "${SYMPHONY_FRONTEND_PORT:-4200}" --ssl=false
