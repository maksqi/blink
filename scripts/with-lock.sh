#!/usr/bin/env sh
# Runs a command while holding a machine-wide lock so parallel agents never run heavy work (nuxt build,
# Playwright, image builds) at the same time.
# Usage: sh scripts/with-lock.sh <command> [args...]
#
# Re-entrant: a command started under the lock (for example `pnpm build:test` inside scripts/e2e.sh) runs directly
# instead of waiting for itself. BLINQ_LOCK_DIR overrides the lock location (default /tmp/blinq-heavy.lock).
set -eu

LOCK_DIR="${BLINQ_LOCK_DIR:-/tmp/blinq-heavy.lock}"

if [ "$#" -eq 0 ]; then
  echo "usage: sh scripts/with-lock.sh <command> [args...]" >&2
  exit 2
fi

# Nested call: an ancestor process already holds the lock.
if [ -n "${BLINQ_LOCK_HELD:-}" ] && [ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" = "$BLINQ_LOCK_HELD" ]; then
  exec "$@"
fi

announced=0
no_pid=0
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$LOCK_DIR" # stale lock left by a killed process
    continue
  fi
  if [ -z "$holder" ]; then
    # The holder writes its pid right after mkdir; a lock without a pid for ~10 s was left by a killed process.
    no_pid=$((no_pid + 1))
    if [ "$no_pid" -ge 5 ]; then
      rm -rf "$LOCK_DIR"
      continue
    fi
  else
    no_pid=0
  fi
  if [ "$announced" -eq 0 ]; then
    echo "with-lock: waiting for $LOCK_DIR (held by pid ${holder:-unknown}: $(cat "$LOCK_DIR/cmd" 2>/dev/null || echo '?'))..." >&2
    announced=1
  fi
  sleep 2
done

echo "$$" > "$LOCK_DIR/pid"
echo "$*" > "$LOCK_DIR/cmd"
trap 'rm -rf "$LOCK_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export BLINQ_LOCK_HELD="$$"
"$@"
