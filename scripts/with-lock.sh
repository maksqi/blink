#!/usr/bin/env sh
# Runs a command while holding a machine-wide lock so parallel agents never run heavy work (nuxt build,
# Playwright, image builds) at the same time.
# Usage: sh scripts/with-lock.sh <command> [args...]
set -eu

LOCK_DIR="${BLINQ_LOCK_DIR:-/tmp/blinq-heavy.lock}"
announced=0

while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$LOCK_DIR" # stale lock left by a killed process
    continue
  fi
  if [ "$announced" -eq 0 ]; then
    echo "with-lock: waiting for $LOCK_DIR (held by pid ${holder:-unknown})..." >&2
    announced=1
  fi
  sleep 2
done

echo "$$" > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
"$@"
