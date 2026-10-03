#!/bin/sh
# blinq Caddy entrypoint (docs/DEPLOYMENT.md §6). Renders /run/blinq/Caddyfile (tmpfs) for this deployment from the
# fragments in /etc/blinq/caddy, validates it, then runs Caddy. A configuration problem stops the container with a
# message that names the variable (docker compose logs caddy).
#
#   DOMAIN        required: the site (app and /rtc signaling)
#   TURN_DOMAIN   optional: TURN/TLS on port 443, routed by SNI to LiveKit, plus a site that only holds its certificate
#   TLS_MODE      acme (ACME_EMAIL, optional ACME_CA) | internal (Caddy's local CA) | files (TLS_CERT_FILE, TLS_KEY_FILE)
#   APP_PORT, LIVEKIT_HTTP_PORT, LIVEKIT_TURN_TLS_PORT, CADDY_HEALTH_PORT: loopback upstreams and the health port
#
# With arguments, the rendered file is validated and the arguments run instead of `caddy run`, for example
#   docker compose run --rm --no-deps caddy caddy adapt --config /run/blinq/Caddyfile --pretty
set -eu

FRAGMENTS=/etc/blinq/caddy
OUT=/run/blinq/Caddyfile

fail() {
  echo "blinq-caddy: $*" >&2
  exit 1
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# A bare hostname: letters, digits, dots and hyphens; no scheme, port or path.
is_hostname() {
  case "$1" in
    '' | *[!a-zA-Z0-9.-]* | .* | *. | *..*) return 1 ;;
  esac
  return 0
}

check_port() {
  case "$2" in
    '' | *[!0-9]*) fail "$1 must be a port number (got '$2')" ;;
  esac
  [ "$2" -ge 1 ] && [ "$2" -le 65535 ] || fail "$1 must be between 1 and 65535 (got '$2')"
}

DOMAIN=$(lower "${DOMAIN:-}")
TURN_DOMAIN=$(lower "${TURN_DOMAIN:-}")
TLS_MODE=${TLS_MODE:-acme}
ACME_EMAIL=${ACME_EMAIL:-}
ACME_CA=${ACME_CA:-}
TLS_CERT_FILE=${TLS_CERT_FILE:-}
TLS_KEY_FILE=${TLS_KEY_FILE:-}
APP_PORT=${APP_PORT:-3000}
LIVEKIT_HTTP_PORT=${LIVEKIT_HTTP_PORT:-7880}
LIVEKIT_TURN_TLS_PORT=${LIVEKIT_TURN_TLS_PORT:-5349}
CADDY_HEALTH_PORT=${CADDY_HEALTH_PORT:-2020}
# The fragments read these through Caddy's {$VAR} placeholders.
export DOMAIN TURN_DOMAIN ACME_EMAIL ACME_CA TLS_CERT_FILE TLS_KEY_FILE \
  APP_PORT LIVEKIT_HTTP_PORT LIVEKIT_TURN_TLS_PORT CADDY_HEALTH_PORT

[ -n "$DOMAIN" ] || fail "DOMAIN is empty: set it in .env (sh scripts/init-env.sh)"
is_hostname "$DOMAIN" || fail "DOMAIN must be a hostname such as meet.example.com, without scheme or port (got '$DOMAIN')"
if [ -n "$TURN_DOMAIN" ]; then
  is_hostname "$TURN_DOMAIN" ||
    fail "TURN_DOMAIN must be a hostname such as turn.meet.example.com, or empty (got '$TURN_DOMAIN')"
  [ "$TURN_DOMAIN" != "$DOMAIN" ] ||
    fail "TURN_DOMAIN must differ from DOMAIN (both are '$DOMAIN'): use a second name such as turn.$DOMAIN, or leave it empty"
fi
check_port APP_PORT "$APP_PORT"
check_port LIVEKIT_HTTP_PORT "$LIVEKIT_HTTP_PORT"
check_port LIVEKIT_TURN_TLS_PORT "$LIVEKIT_TURN_TLS_PORT"
check_port CADDY_HEALTH_PORT "$CADDY_HEALTH_PORT"

case "$TLS_MODE" in
  acme | internal) ;;
  files)
    for pair in "TLS_CERT_FILE=$TLS_CERT_FILE" "TLS_KEY_FILE=$TLS_KEY_FILE"; do
      name=${pair%%=*}
      path=${pair#*=}
      [ -n "$path" ] || fail "TLS_MODE=files needs $name (a path inside the container, see docs/DEPLOYMENT.md §6)"
      [ -f "$path" ] && [ -r "$path" ] ||
        fail "$name=$path is missing or unreadable inside the caddy container (mount it, see docs/DEPLOYMENT.md §6)"
    done
    ;;
  *) fail "TLS_MODE must be acme, internal or files (got '$TLS_MODE')" ;;
esac

# Global options. The {$VAR} placeholders stay literal here; Caddy expands them from the exported variables.
# shellcheck disable=SC2016 # single quotes keep Caddy's {$VAR} placeholders
render_global() {
  echo '{'
  cat << 'EOF'
	# No admin API: the configuration never changes at runtime.
	admin off
	persist_config off
	# Caddy's error log (a 502 from LiveKit or the app, a 413) repeats the request without the filters of the site's
	# access loggers (site.caddyfile), so it gets the pages filter: no query at all (/rtc carries the LiveKit token).
	log errors {
		include http.log.error
		output stderr
		format filter {
			wrap json
			request>uri regexp \?.*$ ?REDACTED
			request>headers>Referer regexp \?.*$ ?REDACTED
		}
	}
	# Requests for any other host name (scanners) are not logged: their access log would be unfiltered as well.
	log default {
		exclude http.log.access http.log.error
	}
EOF
  case "$TLS_MODE" in
    acme)
      if [ -n "$ACME_EMAIL" ]; then
        echo '	email {$ACME_EMAIL}'
      fi
      if [ -n "$ACME_CA" ]; then
        echo '	acme_ca {$ACME_CA}'
      fi
      ;;
    internal)
      cat << 'EOF'
	# Caddy's local CA. The container cannot install its root into a trust store; clients do that themselves.
	local_certs
	skip_install_trust
EOF
      ;;
  esac
  if [ -n "$TURN_DOMAIN" ]; then
    cat "$FRAGMENTS/turn-listener.caddyfile"
  fi
  echo '}'
}

# The tls directive of each site, per mode (acme and internal need none on the main site).
# shellcheck disable=SC2016 # single quotes keep Caddy's {$VAR} placeholders
render_snippets() {
  echo '(blinq_site_tls) {'
  if [ "$TLS_MODE" = files ]; then
    echo '	tls {$TLS_CERT_FILE} {$TLS_KEY_FILE}'
  fi
  echo '}'
  echo '(blinq_turn_tls) {'
  case "$TLS_MODE" in
    # The layer4 listener wrapper takes every TLS connection for TURN_DOMAIN, including TLS-ALPN challenges, so the
    # certificate is obtained with the HTTP-01 challenge on port 80.
    acme) printf '\ttls {\n\t\tissuer acme {\n\t\t\tdisable_tlsalpn_challenge\n\t\t}\n\t}\n' ;;
    files) echo '	tls {$TLS_CERT_FILE} {$TLS_KEY_FILE}' ;;
  esac
  echo '}'
}

mkdir -p "${OUT%/*}"
{
  render_global
  echo
  render_snippets
  echo
  cat "$FRAGMENTS/site.caddyfile"
  if [ -n "$TURN_DOMAIN" ]; then
    echo
    cat "$FRAGMENTS/turn-site.caddyfile"
  fi
  echo
  cat "$FRAGMENTS/health.caddyfile"
} > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
caddy fmt --overwrite "$OUT"

if ! output=$(caddy validate --config "$OUT" --adapter caddyfile 2>&1); then
  printf '%s\n' "$output" >&2
  fail "the rendered configuration $OUT is invalid (details above)"
fi

echo "blinq-caddy: DOMAIN=$DOMAIN TURN_DOMAIN=${TURN_DOMAIN:-(none)} TLS_MODE=$TLS_MODE" >&2
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec caddy run --config "$OUT" --adapter caddyfile
