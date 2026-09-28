# syntax=docker/dockerfile:1
# blinq app image: the Nuxt/Nitro server, the operator CLI and ffmpeg (docs/DEPLOYMENT.md).
# docker-compose.yml builds it as blinq-app:local; a clean build from committed files only:
#   git archive --format=tar HEAD | docker build -t blinq-app:clean -
#
# Build and runtime use the same Debian base, so the native @node-rs/argon2 binding that Nitro traces into
# .output/server/node_modules matches the runtime libc (glibc).
ARG NODE_IMAGE=node:24-bookworm-slim

FROM mwader/static-ffmpeg:9.0.2 AS ffmpeg

FROM ${NODE_IMAGE} AS build
ENV CI=1 \
    NUXT_TELEMETRY_DISABLED=1
# (decision) A pinned npm install instead of a corepack download at build time.
RUN npm install --global --no-fund --no-audit pnpm@11.20.0
WORKDIR /src
# Dependencies first, so source changes reuse the downloaded store.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store
COPY . .
# The postinstall hook (`nuxt prepare`) needs the sources, hence the second, offline install.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store
# vendor assets, nuxt build and the CLI bundle (.output/server/cli.mjs). BLINQ_TEST_HOOKS is never set here.
RUN pnpm build

FROM ${NODE_IMAGE} AS runtime
ARG BLINQ_VERSION=unknown
ARG BLINQ_REVISION=unknown
LABEL org.opencontainers.image.title="blinq" \
      org.opencontainers.image.description="Self-hosted, end-to-end encrypted video conferencing." \
      org.opencontainers.image.source="https://github.com/maksqi/blinq" \
      org.opencontainers.image.version="${BLINQ_VERSION}" \
      org.opencontainers.image.revision="${BLINQ_REVISION}"

# (decision) Fixed uid/gid 10001. /data/recordings is created with that owner so a new named volume inherits it.
RUN groupadd --system --gid 10001 blinq \
 && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin blinq \
 && mkdir -p /data/recordings /work \
 && chown 10001:10001 /data/recordings /work \
 && chmod 0700 /data/recordings /work

COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
# Owned by root and read-only for the app user.
COPY --from=build /src/.output /app/.output
COPY --from=build /src/server/database/migrations /app/migrations
COPY --chmod=0755 docker/app/entrypoint.sh docker/app/healthcheck.mjs /app/docker/

ENV NODE_ENV=production \
    NITRO_HOST=127.0.0.1 \
    NITRO_PORT=3000 \
    MIGRATIONS_DIR=/app/migrations \
    RECORDINGS_DIR=/data/recordings \
    RECORDING_WORK_DIR=/work \
    FFMPEG_PATH=/usr/local/bin/ffmpeg \
    FFPROBE_PATH=/usr/local/bin/ffprobe

WORKDIR /app
USER 10001:10001
STOPSIGNAL SIGTERM
# Mirrors the healthcheck in docker-compose.yml.
HEALTHCHECK --interval=10s --timeout=5s --start-period=120s --start-interval=2s --retries=6 \
  CMD ["node", "/app/docker/healthcheck.mjs"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
