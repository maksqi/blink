#!/usr/bin/env sh
# Creates the production .env (docs/DEPLOYMENT.md §7): copies .env.example, asks for the public names and the first
# admin, generates every secret from /dev/urandom and sets mode 600. It never overwrites an existing file without
# --force.
#
#   sh scripts/init-env.sh                                   interactive
#   DOMAIN=meet.example.com sh scripts/init-env.sh --yes     no questions; values come from options or the environment
#
# Options (each value can also come from the environment variable of the same name):
#   --domain NAME        DOMAIN (required)
#   --turn-domain NAME   TURN_DOMAIN (default turn.<DOMAIN>; an empty value turns TURN/TLS off)
#   --admin-email ADDR   ADMIN_EMAIL (default admin@<DOMAIN>)
#   --acme-email ADDR    ACME_EMAIL (default ADMIN_EMAIL)
#   --tls-mode MODE      TLS_MODE: acme (default) | internal | files
#   --node-ip IP         LIVEKIT_NODE_IP (default empty: LiveKit finds the public address with STUN)
#   --output FILE        write FILE instead of .env (relative to the repository root)
#   --set KEY=VALUE      set any other variable of .env.example (repeatable)
#   --force              overwrite an existing file
#   --quiet              do not print the generated admin password
#   --yes                never ask
# ADMIN_PASSWORD is generated unless the environment sets it; there is deliberately no option for it, so it never
# lands in the shell history.
set -eu

cd "$(dirname "$0")/.."

usage() { sed -n '2,24s/^# \{0,1\}//p' "$0"; }
die() {
  printf 'init-env: %s\n' "$*" >&2
  exit 1
}

output=.env
force=0
quiet=0
assume_yes=0
extra=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN=${2?--domain needs a value}; shift ;;
    --turn-domain) TURN_DOMAIN=${2?--turn-domain needs a value}; shift ;;
    --admin-email) ADMIN_EMAIL=${2?--admin-email needs a value}; shift ;;
    --acme-email) ACME_EMAIL=${2?--acme-email needs a value}; shift ;;
    --tls-mode) TLS_MODE=${2?--tls-mode needs a value}; shift ;;
    --node-ip) LIVEKIT_NODE_IP=${2?--node-ip needs a value}; shift ;;
    --output) output=${2?--output needs a value}; shift ;;
    --set)
      case "${2-}" in
        [A-Z]*=*) extra="$extra
$2" ;;
        *) die "--set needs KEY=VALUE (got '${2-}')" ;;
      esac
      shift
      ;;
    --force) force=1 ;;
    --quiet) quiet=1 ;;
    --yes | -y) assume_yes=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option '$1' (see --help)" ;;
  esac
  shift
done

[ -f .env.example ] || die ".env.example not found (run the script from a blinq checkout)"
if [ -e "$output" ] && [ "$force" -ne 1 ]; then
  die "$output already exists. Keep it (it holds RECORDING_ENCRYPTION_KEY), or pass --force to replace it."
fi
if [ "$assume_yes" -ne 1 ] && ! [ -t 0 ]; then
  die "stdin is not a terminal: pass --yes and the values as options or environment variables"
fi

# --- Input -----------------------------------------------------------------------------------------------------------

ask() { # ask VAR "Question" default
  if [ "$assume_yes" -eq 1 ]; then
    eval "$1=\$3"
    return
  fi
  printf '%s [%s]: ' "$2" "$3" >&2
  IFS= read -r answer || answer=''
  [ -n "$answer" ] || answer=$3
  eval "$1=\$answer"
}

is_hostname() {
  case "$1" in
    '' | *[!a-z0-9.-]* | .* | *. | *..* | *.-* | *-.* | -*) return 1 ;;
    *.*) return 0 ;;
    *) return 1 ;;
  esac
}
is_email() {
  case "$1" in
    *[!A-Za-z0-9._%+@-]* | *@*@* | @* | *@) return 1 ;;
    *@*.*) return 0 ;;
    *) return 1 ;;
  esac
}
is_ipv4() {
  case "$1" in
    '' | *[!0-9.]* | *..* | .* | *.) return 1 ;;
  esac
  old_ifs=$IFS
  IFS=.
  # shellcheck disable=SC2086 # split the address into its parts
  set -- $1
  IFS=$old_ifs
  [ "$#" -eq 4 ] || return 1
  for part in "$@"; do [ "$part" -le 255 ] || return 1; done
  return 0
}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

if [ "$assume_yes" -eq 1 ] && [ -z "${DOMAIN:-}" ]; then
  die "DOMAIN is required (--domain meet.example.com or DOMAIN=...)"
fi
ask DOMAIN 'Public hostname of blinq (DOMAIN)' "${DOMAIN:-meet.example.com}"
DOMAIN=$(lower "$DOMAIN")
is_hostname "$DOMAIN" || die "DOMAIN must be a hostname such as meet.example.com, without scheme or port (got '$DOMAIN')"

# An explicitly empty TURN_DOMAIN turns TURN/TLS off; unset means the default.
turn_default=${TURN_DOMAIN-turn.$DOMAIN}
if [ "$assume_yes" -eq 1 ]; then
  TURN_DOMAIN=$turn_default
else
  ask TURN_DOMAIN "Second hostname for TURN over TLS on port 443 (TURN_DOMAIN, '-' for none)" "${turn_default:--}"
  [ "$TURN_DOMAIN" != '-' ] || TURN_DOMAIN=''
fi
TURN_DOMAIN=$(lower "$TURN_DOMAIN")
if [ -n "$TURN_DOMAIN" ]; then
  is_hostname "$TURN_DOMAIN" || die "TURN_DOMAIN must be a hostname such as turn.$DOMAIN, or empty (got '$TURN_DOMAIN')"
  [ "$TURN_DOMAIN" != "$DOMAIN" ] || die "TURN_DOMAIN must differ from DOMAIN"
fi

ask ADMIN_EMAIL 'Email of the first administrator (ADMIN_EMAIL)' "${ADMIN_EMAIL:-admin@$DOMAIN}"
is_email "$ADMIN_EMAIL" || die "ADMIN_EMAIL is not a valid email address (got '$ADMIN_EMAIL')"

ask TLS_MODE 'Certificates: acme (Let'"'"'s Encrypt), internal (local CA) or files (TLS_MODE)' "${TLS_MODE:-acme}"
case "$TLS_MODE" in
  acme | internal | files) ;;
  *) die "TLS_MODE must be acme, internal or files (got '$TLS_MODE')" ;;
esac

if [ "$TLS_MODE" = acme ]; then
  ask ACME_EMAIL "Email for Let's Encrypt expiry notices (ACME_EMAIL)" "${ACME_EMAIL:-$ADMIN_EMAIL}"
  is_email "$ACME_EMAIL" || die "ACME_EMAIL is not a valid email address (got '$ACME_EMAIL')"
else
  ACME_EMAIL=${ACME_EMAIL:-}
fi

# Suggest the address DOMAIN resolves to: clients reach the server there, so media should use it too.
node_ip_default=${LIVEKIT_NODE_IP:-}
if [ "$assume_yes" -ne 1 ] && [ -z "$node_ip_default" ] && command -v getent > /dev/null 2>&1; then
  node_ip_default=$(getent ahostsv4 "$DOMAIN" 2> /dev/null | awk 'NR == 1 { print $1 }' || true)
fi
ask LIVEKIT_NODE_IP "Public IPv4 of this server for media (LIVEKIT_NODE_IP, '-' to detect it with STUN)" "${node_ip_default:--}"
[ "$LIVEKIT_NODE_IP" != '-' ] || LIVEKIT_NODE_IP=''
if [ -n "$LIVEKIT_NODE_IP" ]; then
  is_ipv4 "$LIVEKIT_NODE_IP" || die "LIVEKIT_NODE_IP must be an IPv4 address (got '$LIVEKIT_NODE_IP')"
fi

# --- Secrets ---------------------------------------------------------------------------------------------------------

# N random characters from [A-Za-z0-9_-] (or the given set): URL-safe and free of "$", which Compose would expand.
random_chars() {
  LC_ALL=C tr -dc "${2:-A-Za-z0-9_-}" < /dev/urandom | head -c "$1"
}

# Never a value that the startup checks would take for a placeholder.
secret() {
  while :; do
    value=$(random_chars "$1")
    case "$(lower "$value")" in
      change* | replace* | example* | placeholder* | secret* | password* | *changeme* | *change-me* | *replaceme* | \
        *replace-me* | *placeholder*) ;;
      *)
        printf '%s' "$value"
        return
        ;;
    esac
  done
}

generated_password=0
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  admin_password=$ADMIN_PASSWORD
  [ "${#admin_password}" -ge 12 ] || die "ADMIN_PASSWORD must have at least 12 characters"
  case "$admin_password" in
    *"'"* | *'"'* | *\\* | *' '*) die "ADMIN_PASSWORD must not contain quotes, backslashes or spaces" ;;
  esac
else
  admin_password=$(secret 32)
  generated_password=1
fi

APP_SECRET=$(secret 48)
LIVEKIT_API_SECRET=$(secret 48)
POSTGRES_PASSWORD=$(secret 40)
LIVEKIT_API_KEY="API$(random_chars 12 'A-Za-z0-9')"
RECORDING_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64 | tr -d '\n')

# --- Write -------------------------------------------------------------------------------------------------------------

umask 077
tmp="$output.tmp.$$"
trap 'rm -f "$tmp" "$tmp.next"' EXIT
cp .env.example "$tmp"

# Replaces `KEY=...` (or a commented `# KEY=...`) with KEY=VALUE, or appends it. The value is passed through the
# environment, so awk never interprets backslashes in it.
set_var() {
  KEY=$1 VALUE=$2 awk '
    BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"] }
    !done && (index($0, key "=") == 1 || index($0, "# " key "=") == 1) { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$tmp" > "$tmp.next"
  mv "$tmp.next" "$tmp"
}

# Values made only of safe characters are written as they are; anything else in single quotes (Compose keeps it
# literal, "$" included).
quoted() {
  case "$1" in
    *[!A-Za-z0-9_@.:/+=,-]*) printf "'%s'" "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

set_var DOMAIN "$DOMAIN"
set_var TURN_DOMAIN "$TURN_DOMAIN"
set_var TLS_MODE "$TLS_MODE"
set_var ACME_EMAIL "$ACME_EMAIL"
set_var ADMIN_EMAIL "$ADMIN_EMAIL"
set_var ADMIN_PASSWORD "$(quoted "$admin_password")"
set_var APP_SECRET "$APP_SECRET"
set_var RECORDING_ENCRYPTION_KEY "$RECORDING_ENCRYPTION_KEY"
set_var LIVEKIT_API_KEY "$LIVEKIT_API_KEY"
set_var LIVEKIT_API_SECRET "$LIVEKIT_API_SECRET"
set_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
set_var LIVEKIT_NODE_IP "$LIVEKIT_NODE_IP"

if [ -n "$extra" ]; then
  while IFS= read -r pair; do
    [ -n "$pair" ] || continue
    key=${pair%%=*}
    grep -q "^#\{0,1\} \{0,1\}$key=" .env.example || die "--set $key: not a variable of .env.example"
    set_var "$key" "$(quoted "${pair#*=}")"
  done << EOF
$extra
EOF
fi

mv "$tmp" "$output"
chmod 600 "$output"
trap - EXIT

# --- Summary -----------------------------------------------------------------------------------------------------------

cat << EOF
Wrote $output (mode 600).
  DOMAIN=$DOMAIN
  TURN_DOMAIN=${TURN_DOMAIN:-(empty: TURN over TLS is off)}
  TLS_MODE=$TLS_MODE
  ADMIN_EMAIL=$ADMIN_EMAIL
  LIVEKIT_NODE_IP=${LIVEKIT_NODE_IP:-(empty: detected with STUN at startup)}
EOF
if [ "$generated_password" -eq 1 ] && [ "$quiet" -ne 1 ]; then
  cat << EOF

First admin password (shown only now; blinq asks you to change it at the first login):
  $admin_password
EOF
fi
cat << EOF

Next steps:
  1. sh scripts/preflight.sh
  2. docker compose up -d --wait
  3. Log in at https://$DOMAIN, change the password, then remove ADMIN_PASSWORD from $output.
Back up $output somewhere safe and separate from the recordings: without RECORDING_ENCRYPTION_KEY, stored recordings
cannot be decrypted. When you edit values by hand, wrap any value that contains "\$" in single quotes.
EOF
