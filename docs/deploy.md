# Deploying Deckhand

Deckhand runs as one Node process that serves the JSON API and the built React app. The production image also contains the static deck runtime, deck scaffolds, database migrations, and the Chromium build required for exports and scaffold thumbnails.

## Prerequisites

- Docker Engine with the `docker compose` plugin.
- A public hostname and reverse proxy for TLS.
- Provider, SMTP, and authentication credentials appropriate for the deployment.
- npm and GNU tar only when using the backup script directly on the host.

## Environment

Create a `.env` file in the repository root before using Compose. It is required by `docker-compose.yml` and must never be committed. A minimal production-oriented starting point is:

```dotenv
PUBLIC_BASE_URL=https://app.example.com
PORT=4321
HOST=0.0.0.0
DECKHAND_DATA_DIR=/app/.data

AUTH_DEV_LINK=false
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=replace-me
SMTP_PASS=replace-me
SMTP_FROM=Deckhand <deckhand@example.com>

AGENT_BASE_URL=https://provider.example.com/v1
AGENT_API_KEY=replace-me
MEMBER_AGENT_MODEL=replace-me
ADMIN_AGENT_MODEL=replace-me
```

`PUBLIC_BASE_URL` must be the externally reachable application URL. Compose always binds the process to `HOST=0.0.0.0` and port 4321 inside the container; `PORT` controls the published host port. Keep `DECKHAND_DATA_DIR=/app/.data` with the supplied Compose file so state lands on the named volume.

`DATABASE_URL` is optional. Leave it unset for the default JSON-file mode. SMTP uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. `AUTH_DEV_LINK` should be `false` for production exposure. Agent configuration uses `AGENT_BASE_URL`, `AGENT_API_KEY`, and either `MEMBER_AGENT_MODEL`/`ADMIN_AGENT_MODEL` or the shared `AGENT_MODEL`. The server also supports the related timeout, auth bootstrap, domain, and database SSL settings defined in `apps/server/src/core/config.ts`.

The image sets `SKIP_ENV_LOCAL=true`; `.env.local` is not copied or loaded in a container.

## Start in JSON-file mode

With `DATABASE_URL` absent from `.env`:

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:${PORT:-4321}/api/health
```

The app healthcheck uses the same `/api/health` endpoint.

## Start with Postgres

Set unique Postgres credentials and a service-network database URL in `.env`:

```dotenv
POSTGRES_DB=deckhand
POSTGRES_USER=deckhand
POSTGRES_PASSWORD=replace-with-a-strong-secret
DATABASE_URL=postgresql://deckhand:URL_ENCODED_PASSWORD@postgres:5432/deckhand
```

Build the app, start Postgres, wait for it to become healthy, run migrations once, and then start the app:

```bash
docker compose build app
docker compose --profile postgres up -d postgres
docker compose --profile postgres ps
docker compose --profile postgres run --rm app node apps/server/dist/db/migrate.js
docker compose --profile postgres up -d app
```

For later deployments, `docker compose --profile postgres up -d --build` updates both services. The server also checks migrations at startup, but the explicit one-off command verifies database connectivity before serving traffic.

## Persistent data and backups

The `deckhand-data` volume is mounted at `/app/.data`. It contains the deck files edited by the agent, JSON-mode metadata and auth state, templates, job records, and generated output. Exports and thumbnails are regenerable and are excluded from backups; job records are retained. The optional `deckhand-pg` volume holds Postgres data.

For a host/local data directory, stop Deckhand or otherwise quiesce writes, then run:

```bash
npm run backup:data
DECKHAND_DATA_DIR=/another/data/path npm run backup:data
```

Archives are written to `backups/deckhand-data-<UTC timestamp>.tar.gz`. They exclude logs, thumbnails, exports, `*-tmp` directories, and `node_modules`.

To back up the Compose named volume with the same script, stop the app and run the script in a one-off container while mounting the script and host backup directory:

```bash
mkdir -p backups
docker compose stop app
docker compose run --rm --no-deps --user root \
  -v "$PWD/scripts/backup-data.sh:/app/scripts/backup-data.sh:ro" \
  -v "$PWD/backups:/app/backups" \
  app npm run backup:data
docker compose start app
```

Restore only while the app is stopped. Extraction overwrites matching files but deliberately leaves files absent from the archive unchanged:

```bash
npm run backup:data -- --restore backups/deckhand-data-YYYYMMDDTHHMMSSZ.tar.gz
```

For the Compose volume, use the same root one-off container mounts and append `-- --restore backups/<archive>` to the `npm run backup:data` command. Then restore ownership before starting the app:

```bash
docker compose run --rm --no-deps --user root app chown -R pwuser:pwuser /app/.data
```

Take a fresh backup first if restoring over an existing data directory.

## Chromium and TLS

The runtime stage uses `mcr.microsoft.com/playwright:v1.59.1-noble`, matching the locked Playwright package. Chromium and its system dependencies are already installed at `/ms-playwright`; the Docker build does not download browsers or run `playwright install`.

Terminate TLS in a reverse proxy. Use [`deploy/Caddyfile.example`](../deploy/Caddyfile.example) as the starting point for the app and deck hostnames rather than duplicating TLS configuration in the application container.
