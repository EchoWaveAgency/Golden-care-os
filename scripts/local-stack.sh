#!/usr/bin/env bash
# Runs a Supabase-compatible stack WITHOUT Docker for local development and E2E checks:
# PostgreSQL 16 + Supabase Auth + PostgREST + a tiny gateway on http://localhost:54321.
# Downloads the Auth and PostgREST release binaries from GitHub on first run.
# Local development only. Never use these keys anywhere else.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="$ROOT/.localstack"; BIN="$STACK/bin"; DATA="$STACK/pg"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"; PG_PORT=54322
JWT_SECRET="local-dev-only-jwt-secret-with-at-least-32-chars"
RUN_AS=(); [ "$(id -u)" = "0" ] && RUN_AS=(runuser -u postgres --)
mkdir -p "$BIN"

if [ ! -x "$BIN/postgrest" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ -C "$BIN"
fi
if [ ! -x "$BIN/auth" ]; then
  curl -sSL https://github.com/supabase/auth/releases/download/v2.169.0/auth-v2.169.0-x86.tar.gz | tar xz -C "$BIN"
fi

stop() { for pat in "[.]localstack/bin/postgrest" "[.]localstack/bin/auth serve" "scripts/local/[p]roxy.mjs"; do
           pkill -f "$pat" 2>/dev/null || true; done
         "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true; }
if [ "${1:-}" = "stop" ]; then stop; exit 0; fi
stop

rm -rf "$DATA"; mkdir -p "$DATA"; [ "$(id -u)" = "0" ] && chown -R postgres "$STACK"
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$STACK/pg.log" start >/dev/null
export PGHOST=127.0.0.1 PGPORT=$PG_PORT PGUSER=postgres PGDATABASE=postgres
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/scripts/local/roles.sql"

# Supabase Auth creates the auth schema (users, sessions, auth.uid()).
export GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:local-dev-only@127.0.0.1:$PG_PORT/postgres?sslmode=disable"
export GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
export GOTRUE_SITE_URL=http://localhost:3000 API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_API_HOST=127.0.0.1 PORT=9999
export GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_LOG_LEVEL=warn
(cd "$BIN" && ./auth migrate >/dev/null 2>&1)

export PGOPTIONS="-c search_path=public,extensions -c client_min_messages=warning"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
unset PGOPTIONS

(cd "$BIN" && nohup "$BIN/auth" serve >"$STACK/auth.log" 2>&1 &)
PGRST_DB_URI="postgres://authenticator:local-dev-only@127.0.0.1:$PG_PORT/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=3000 PGRST_SERVER_HOST=127.0.0.1 \
  nohup "$BIN/postgrest" >"$STACK/postgrest.log" 2>&1 &
nohup node "$ROOT/scripts/local/proxy.mjs" >"$STACK/proxy.log" 2>&1 &
sleep 2

ANON=$(node -e "console.log(require('$ROOT/scripts/local/jwt.cjs').sign('anon','$JWT_SECRET'))")
SERVICE=$(node -e "console.log(require('$ROOT/scripts/local/jwt.cjs').sign('service_role','$JWT_SECRET'))")
cat > "$ROOT/.env.local" <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
NEXT_PUBLIC_SITE_URL=http://localhost:3100
# Local development only: messages are logged, not sent; the portal shows the sign-in code on screen.
MESSAGING_MODE=dev
PORTAL_DEV_SHOW_OTP=true
PAYMENTS_MODE=dev
CARE_SIMULATOR=on
EINVOICE_MODE=dev
FILES_MODE=local
CRON_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
WHATSAPP_VERIFY_TOKEN=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
ENV
echo "Local stack ready on http://localhost:54321 (.env.local written). Next: npm run demo:data"
