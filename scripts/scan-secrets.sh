#!/usr/bin/env sh
# Scans the git history of HEAD for committed secrets with a pinned gitleaks image and .gitleaks.toml.
# CI runs the same command (ci.yml, job gitleaks). Extra arguments go to `gitleaks git`.
#   sh scripts/scan-secrets.sh
set -eu

cd "$(dirname "$0")/.."
GITLEAKS_IMAGE=zricethezav/gitleaks:v8.30.1
root=$(pwd -P)
common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)

# HEAD only: in a worktree `--all` (the gitleaks default) would also scan other agents' branches.
scan() {
  docker run --rm "$@" -w "$root" "$GITLEAKS_IMAGE" git \
    --config .gitleaks.toml --redact --no-banner --verbose --log-opts="--full-history HEAD" .
}

case "$common" in
  "$root"/*) scan -v "$root:$root:ro" ;;
  # A git worktree keeps its history in the main repository: mount that too, at the same path.
  *) scan -v "$root:$root:ro" -v "$common:$common:ro" ;;
esac
