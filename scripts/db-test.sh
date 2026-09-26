#!/usr/bin/env bash
# Runs every migration, the seed, and the SQL test suite against a throwaway local
# PostgreSQL 16 cluster. Requires PostgreSQL 16 server binaries on the machine.
# Usage: npm run db:test
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DATA="$ROOT/.pgtest/data"
PORT="${PGTEST_PORT:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); fi

cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$ROOT/.pgtest"; mkdir -p "$ROOT/.pgtest"
[ "$(id -u)" = "0" ] && chown postgres "$ROOT/.pgtest"
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=''" -l "$ROOT/.pgtest/log" start >/dev/null

export PGHOST=/tmp PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
export PGOPTIONS="-c search_path=public,extensions -c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f "$ROOT/supabase/tests/_supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "seed     seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/_fixtures.sql"

fail=0
for t in "$ROOT"/supabase/tests/[0-9]*.sql; do
  if out=$("${PSQL[@]}" -o /dev/null -f "$t" 2>&1); then
    echo "PASS     $(basename "$t")"
    [ -n "$out" ] && echo "$out" | sed 's/^/         /'
  else
    echo "FAIL     $(basename "$t")"; echo "$out" | sed 's/^/         /'; fail=1
  fi
done
if out=$(bash "$ROOT/supabase/tests/concurrency.sh" 2>&1); then
  echo "PASS     concurrency.sh"; echo "$out" | sed 's/^/         /'
else
  echo "FAIL     concurrency.sh"; echo "$out" | sed 's/^/         /'; fail=1
fi
exit $fail
