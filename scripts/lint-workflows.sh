#!/usr/bin/env sh
# Lints the CI surface from a pinned image: .github/workflows with actionlint (which also runs shellcheck on every
# `run:` script), then the repository's shell scripts with the image's shellcheck.
# CI runs the same command (ci.yml, job actionlint). Extra arguments go to actionlint.
#   sh scripts/lint-workflows.sh
set -eu

cd "$(dirname "$0")/.."
ACTIONLINT_IMAGE=rhysd/actionlint:1.7.12

docker run --rm -v "$(pwd -P):/repo:ro" -w /repo "$ACTIONLINT_IMAGE" "$@"
# shellcheck disable=SC2046 # one argument per script (tracked or new; the paths contain no spaces)
docker run --rm -v "$(pwd -P):/repo:ro" -w /repo --entrypoint shellcheck "$ACTIONLINT_IMAGE" \
  --shell=sh $(git ls-files --cached --others --exclude-standard '*.sh')
