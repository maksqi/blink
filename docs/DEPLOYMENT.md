# Deployment

This is the full operator guide for running blinq on your own server. `README.md` has the short version. Markers:
`TODO(stage-09a)` = verified and completed by `infra` when the production files land; `TODO(stage-10)` = replaced
with measured numbers from [`PERFORMANCE.md`](PERFORMANCE.md).

## 1. What runs

`docker compose up -d --wait` starts four containers from `docker-compose.yml`:

| Service | Image | Network | Role |
|---|---|---|---|
| `caddy` | `blinq-caddy:local` (Caddy 2.11.4 + caddy-l4) | host | HTTPS, HTTP/3, certificates, TURN/TLS routing by SNI |
| `app` | `blinq-app:local` (Node 24, Nuxt, ffmpeg) | host, bound to `127.0.0.1` | UI and API; runs migrations and bootstrap on every start |
| `livekit` | `livekit/livekit-server:v1.13.7` | host | SFU for encrypted media, embedded TURN |
| `postgres` | `postgres:18-alpine` | none (unix socket only) | Database |

Architecture and the reasons for host networking: [`ARCHITECTURE.md`](ARCHITECTURE.md). Threat model:
[`SECURITY.md`](SECURITY.md).

## 2. Server requirements

- Linux on x86_64 or arm64 (host networking is Linux-only; Docker Desktop on macOS or Windows is not supported for
  production). Ubuntu 24.04 LTS and Debian 13 are the reference systems.
- Docker Engine ≥ 28.0.1 and the Compose v2 plugin (`docker compose`, not `docker-compose`).
- A public IPv4 address (IPv6 optional), two DNS names, and the ports in §4.

Sizing (all values are estimates until `TODO(stage-10)` replaces them with measurements):

| Use | vCPU | RAM | Bandwidth (each direction) |
|---|---|---|---|
| Trial, one call with up to 10 people | 2 | 2 GB | 50 Mbit/s |
| One full 25-person room | 4 | 4 GB | 150 Mbit/s |
| Several concurrent rooms | 8 or more | 8 GB | 500 Mbit/s or more |

- Recording processing uses a RAM-backed work area of up to `RECORDING_WORK_TMPFS_SIZE` (default `4g`) while a job
  runs. Add it to the RAM figure if you record.
- Disk: about 10 GB for images and the database, plus recordings (roughly 2–3 GB per recorded hour at 1080p,
  estimate).

## 3. DNS

Create records that point at the server:

| Name | Records | Needed for |
|---|---|---|
| `DOMAIN` (e.g. `meet.example.com`) | A (and AAAA if the server has IPv6) | the app, signaling, certificates |
| `TURN_DOMAIN` (e.g. `turn.meet.example.com`) | A (and AAAA) | TURN over TLS on port 443 (recommended) |

- `TURN_DOMAIN` must differ from `DOMAIN`. It is optional: without it, calls from networks that allow only HTTPS
  won't connect, while TURN/UDP and ICE/TCP still work.
- Don't put a CDN or HTTP proxy in front (for Cloudflare: "DNS only"). TURN/TLS and WebRTC media cannot pass through
  it, and the app trusts `X-Forwarded-For` only from its own Caddy.
- If you use CAA records, allow your certificate authority (for example `letsencrypt.org`).
- Check before the first start: `dig +short A meet.example.com` and `dig +short A turn.meet.example.com` print the
  server's public IP. `sh scripts/preflight.sh` checks this too.

## 4. Ports

| Port | Protocol | Exposure | Purpose |
|---|---|---|---|
| 80 | TCP | public | ACME HTTP-01 challenges, redirect to HTTPS |
| 443 | TCP | public | HTTPS, WebSocket signaling (`/rtc`), TURN/TLS (by SNI) |
| 443 | UDP | public | HTTP/3 |
| 3478 | UDP | public | TURN over UDP |
| 7881 | TCP | public | ICE over TCP (fallback when UDP is blocked) |
| 50000–60000 | UDP | public | WebRTC media |
| 30000–40000 | UDP | public **only on 1:1-NAT clouds** | TURN relay hairpin (AWS, GCP, Azure and similar) |
| 3000 | TCP | loopback | app (Caddy proxies to it) |
| 7880 | TCP | loopback | LiveKit HTTP and RoomService (`/twirp` is never public) |
| 5349 | TCP | listens on all interfaces, **keep closed** | TURN plaintext behind Caddy; accepts PROXY-protocol connections from loopback only |
| 2020 | TCP | loopback | Caddy health endpoint |
| — | unix socket | none | Postgres (shared `pgsocket` volume) |

The loopback ports can be changed in `.env` (`APP_PORT`, `LIVEKIT_HTTP_PORT`, `LIVEKIT_TURN_TLS_PORT`,
`CADDY_HEALTH_PORT`) if something else already uses them. The media ports are `LIVEKIT_RTC_TCP_PORT`,
`LIVEKIT_RTC_PORT_RANGE_START`/`_END` and `LIVEKIT_TURN_UDP_PORT`.

## 5. Firewall

Example with ufw (Ubuntu):

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow 3478/udp
sudo ufw allow 7881/tcp
sudo ufw allow 50000:60000/udp
# Only on clouds with 1:1 NAT (the public IP is not on the network interface):
# sudo ufw allow 30000:40000/udp
sudo ufw enable
```

- Docker's iptables rules bypass ufw only for ports published with `ports:`. blinq publishes none: Caddy, LiveKit and
  the app use host networking and Postgres has no network, so these ufw rules govern every listener.
- Never open 5349, 3000, 7880 or 2020.
- Cloud firewalls (security groups) need the same list. On 1:1-NAT clouds open 30000–40000/udp in both the cloud
  firewall and ufw, and set `LIVEKIT_NODE_IP` to the public (elastic) IP.
- firewalld: `sudo firewall-cmd --permanent --add-port=443/udp` and so on for each row, then
  `sudo firewall-cmd --reload`.

## 6. TLS modes

Set `TLS_MODE` in `.env`:

- **`acme`** (default): Let's Encrypt certificates for `DOMAIN` and `TURN_DOMAIN`, renewed automatically. Needs
  public DNS and TCP 80 reachable from the internet. Set `ACME_EMAIL` for expiry notices. While experimenting, set
  `ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` to avoid rate limits, then remove it and run
  `docker compose up -d --force-recreate caddy` to get trusted certificates.
- **`internal`**: Caddy's own CA, for intranet or LAN installs without public DNS. Every client must trust Caddy's
  root certificate: `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./blinq-root.crt`, then
  install it in the OS or browser trust store. Back up the `caddy_data` volume, or clients must trust a new root
  after a reinstall. `TODO(stage-09a)`: confirm TURN/TLS behavior with the internal CA in Chromium and Firefox.
- **`files`**: your own certificate. It must cover both `DOMAIN` and `TURN_DOMAIN` (SAN or wildcard). Mount it with a
  `docker-compose.override.yml`:

  ```yaml
  services:
    caddy:
      volumes:
        - /etc/ssl/blinq:/certs:ro
  ```

  and set `TLS_CERT_FILE=/certs/fullchain.pem` and `TLS_KEY_FILE=/certs/privkey.pem`. Caddy does not watch the files:
  run `docker compose restart caddy` after every renewal.

## 7. Install

1. Install Docker Engine and the Compose plugin from the official Docker repository
   (https://docs.docker.com/engine/install/), then add your user to the `docker` group and log in again.
2. Get the code:

   ```sh
   git clone https://github.com/maksqi/blinq.git
   cd blinq
   git checkout v1.0.0
   ```

3. Create `.env`. The script asks for `DOMAIN`, `TURN_DOMAIN`, `ADMIN_EMAIL` and `ACME_EMAIL`, generates every
   secret, sets mode 600 and prints the first admin password once:

   ```sh
   sh scripts/init-env.sh
   ```

   To do it by hand instead: `cp .env.example .env && chmod 600 .env`, fill in every `REQUIRED` value and generate
   secrets with the `openssl` commands in the comments. Use only letters, digits, `_` and `-` in secrets: Compose
   expands `$`, and the database password becomes part of a URL. Wrap any value containing `$` in single quotes.
4. Optional but recommended, UDP buffers for LiveKit and HTTP/3:

   ```sh
   printf 'net.core.rmem_max=7500000\nnet.core.wmem_max=7500000\n' | sudo tee /etc/sysctl.d/99-blinq.conf
   sudo sysctl --system
   ```

5. Check the host: `sh scripts/preflight.sh`. Fix every failure; read every warning.
6. Start: `docker compose up -d --wait`. The first run builds both images and takes several minutes. The command
   returns once every container is healthy. If it fails, see §12.
7. Open `https://DOMAIN`, log in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, and set a new password when asked.
8. Remove `ADMIN_PASSWORD` from `.env` (it is never used again), then run `docker compose up -d` so the app container
   no longer carries it.
9. In the admin panel: configure registration (invite-only by default), guests, media limits and recording retention.
   With SMTP configured in `.env`, send a test email from the settings page.

`TODO(stage-09a)`: confirm these steps verbatim on the smoke stack and record the first-start duration.

## 8. Upgrades

```sh
cd blinq
# 1. Take a backup (section 9).
git fetch --tags
git checkout v1.0.1          # the release you want
docker compose build --pull  # also refreshes the base images
docker compose up -d --wait
docker compose ps            # every service "healthy"
```

- Migrations run automatically when the app starts (under a database lock, idempotent).
- Downtime is the time it takes to recreate the containers; calls in progress are interrupted.
- Migrations are forward-only. To roll back, restore the pre-upgrade backup and check out the previous tag.
- Run `docker compose build --pull && docker compose up -d --wait` monthly even without a new release to pick up
  security fixes in the base images. `docker image prune` removes old layers.

## 9. Backup and restore

A complete backup is three things, taken together:

1. **The database** (accounts, rooms, recording metadata).
2. **The `recordings` volume** (already encrypted, BLQ1 format).
3. **`.env`**, above all `RECORDING_ENCRYPTION_KEY`. **If this key is lost, every stored recording is unrecoverable.**
   Keep `.env` separately from the recordings backup (for example in a password manager); storing both together
   gives anyone with the backup the plaintext recordings.

Optionally `caddy_data` (certificates, and the internal CA in `internal` mode).

```sh
mkdir -p "$HOME/blinq-backups"
# Database (custom format). The single quotes let the container expand its own variables.
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$HOME/blinq-backups/db-$(date +%F).dump"
# Recordings
docker run --rm -v blinq_recordings:/src:ro -v "$HOME/blinq-backups:/backup" alpine \
  tar -C /src -czf "/backup/recordings-$(date +%F).tar.gz" .
# .env (store it somewhere else, encrypted)
install -m 600 .env "$HOME/blinq-backups/env-$(date +%F)"
```

Restore on a new server (same `.env`, same or newer blinq version):

```sh
docker compose up --no-start          # creates volumes and containers
docker compose start postgres
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < db-YYYY-MM-DD.dump
docker run --rm -v blinq_recordings:/dst -v "$PWD:/backup:ro" alpine tar -C /dst -xzf /backup/recordings-YYYY-MM-DD.tar.gz
docker compose up -d --wait
```

- Wait for `postgres` to be healthy (`docker compose ps`) before `pg_restore`.
- Volume names are prefixed with the project name `blinq`; check with `docker volume ls`. `TODO(stage-09a)`: verify
  these commands against the final compose file.
- Test a restore at least once, and keep backups encrypted at rest.

## 10. Logs and health

```sh
docker compose ps                       # state and health of every service
docker compose logs -f app              # app logs (startup summary, requests, errors)
docker compose logs --since 1h caddy    # certificates, access log (JSON)
docker compose logs livekit             # media server, TURN
curl -fsS https://meet.example.com/api/health   # liveness
curl -fsS https://meet.example.com/api/ready    # database and LiveKit reachable
```

- `LOG_FORMAT=json` makes app logs machine-readable for log shippers; `LOG_LEVEL` controls verbosity.
- At startup the app prints one line: version, public URL, TURN on/off, SMTP on/off, registration mode.
- Docker rotates logs (json-file, 5 files of 10 MB per container). Secrets and tokens are redacted.

## 11. Recovery CLI

Reset any account's password (for example a locked-out admin). The password is read from stdin, never from the
command line; every session of that user is revoked and the action is audited. In bash or zsh:

```sh
read -rs NEW_PASSWORD   # type the new password, press Enter (nothing is shown)
printf '%s\n' "$NEW_PASSWORD" | docker compose exec -T app node .output/server/cli.mjs reset-password admin@example.com
unset NEW_PASSWORD
```

The other commands (`migrate`, `bootstrap`) run automatically at every start.

## 12. Troubleshooting

**`docker compose up` fails with "required variable ... is missing".** The message names the variable; set it in
`.env` (`sh scripts/init-env.sh` generates secrets). Values that still look like placeholders are refused at startup:
`docker compose logs app` names the variable.

**No certificate / ACME errors.** `docker compose logs caddy | grep -i -E 'acme|challenge|certificate'`. Check that
both names resolve to this server, that TCP 80 and 443 are reachable from outside, and that no other web server holds
them. After repeated failures, use `ACME_CA` (staging) until it works: Let's Encrypt rate-limits failed validations.

**Calls work on some networks only, or never from networks that allow only HTTPS.** Test TURN/TLS:
`openssl s_client -connect turn.meet.example.com:443 -servername turn.meet.example.com </dev/null`. It must present
the `TURN_DOMAIN` certificate. The `DOMAIN` certificate means `TURN_DOMAIN` is empty or Caddy was started before it
was set: `docker compose up -d --force-recreate caddy livekit`.

**Firefox connects only over UDP, never through TURN/TLS.** Firefox rejects TURN answers that report a loopback
address, so PROXY protocol must be on at both ends (Caddy `proxy_protocol v2`, LiveKit `turn.proxy_protocol`).
Check `docker compose logs livekit` for TURN errors.

**Relay-only test (UDP blocked).** On a client, block outbound UDP (except DNS) with the OS firewall, set
`media.peerconnection.ice.relay_only` to `true` in Firefox `about:config`, and join a call. `about:webrtc` (or
`chrome://webrtc-internals` in Chrome) must show a selected candidate pair of type `relay` over TLS on port 443.

**Participants connect but see no video, or "could not establish pc connection".** Usually the advertised IP or
firewall is wrong. Set `LIVEKIT_NODE_IP` to the server's public IPv4 (the elastic IP on 1:1-NAT clouds), open
7881/tcp and 50000–60000/udp, then `docker compose up -d livekit`. `docker compose logs livekit` shows the node IP at
startup.

**A port is already in use.** `sudo ss -tulpn | grep -E ':(80|443|3478|7881|3000|7880|5349|2020)\b'`. Stop the other
service (often Apache or nginx on 80/443) or move blinq's loopback ports in `.env`.

**Docker older than 28.0.1 or Compose v1.** Upgrade from the official Docker repository. Compose v1 (`docker-compose`)
cannot parse the file.

**App unhealthy, `/api/ready` returns 503.** The database or LiveKit is unreachable: `docker compose ps` and
`docker compose logs app postgres livekit`. "password authentication failed" after editing `POSTGRES_PASSWORD`: the
password is set only when the database is created; change it back, or run `ALTER USER` inside the container.

**Recording stuck in "processing" or "failed".** `docker compose logs app | grep -i recording`. Common causes: the
work area is too small (`RECORDING_WORK_TMPFS_SIZE` should be about twice the longest recording), the job hit
`FFMPEG_TIMEOUT_MINUTES`, the disk is full, or the browser produced media outside the allowlist. Failed recordings
are never served; the error is shown in the recordings list.

**"This browser is not supported".** The browser lacks the APIs needed for end-to-end encryption. See the browser
matrix in `README.md`.

## 13. Security hardening

- Keep the host patched (for example `unattended-upgrades`), allow SSH keys only, and rebuild images monthly (§8).
- `.env` stays mode 600 and never leaves the server unencrypted.
- Deploy tagged releases and review changes before upgrading: a compromised server can serve JavaScript that leaks
  room keys (see [`SECURITY.md`](SECURITY.md)).
- Don't expose 5349, 3000, 7880 or 2020, and don't put another reverse proxy or CDN in front (unsupported in v1).
- Keep registration invite-only unless you need otherwise; review guest access and retention in the admin panel.
- Secret rotation:
  - A new `APP_SECRET` invalidates every room invite link.
  - A new `LIVEKIT_API_SECRET` needs `docker compose up -d` so the app and LiveKit restart together.
  - `RECORDING_ENCRYPTION_KEY` cannot be rotated in v1: changing it makes existing recordings unreadable.

## 14. Uninstall

`docker compose down` stops and removes the containers and keeps all data. `docker compose down -v` also deletes the
database, recordings and certificates. This cannot be undone.
