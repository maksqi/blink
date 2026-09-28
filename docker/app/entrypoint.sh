#!/bin/sh
# blinq app container entrypoint. On every start: apply migrations, run the one-time admin bootstrap (both idempotent
# and serialized by a database lock), then replace this shell with the server.
# A failing step stops the container with its exit code before the server starts. Never prints the environment: it
# holds the secrets.
set -eu

cd /app

step() {
  status=0
  node .output/server/cli.mjs "$1" || status=$?
  if [ "$status" -ne 0 ]; then
    echo "[blinq] entrypoint: '$1' failed with exit code $status; the server was not started (see the lines above)." >&2
    exit "$status"
  fi
}

step migrate
step bootstrap
exec node .output/server/index.mjs
