# Smoke Tests

## Basic Scaffold

The basic v1 scaffold lives in `themes/basic`. It is intentionally dependency-free in this repo and expects a Slidev CLI to be supplied by the caller when publish/export checks are run.

Run the scaffold smoke test:

```sh
scripts/smoke-basic.sh
```

The script expects the repo's existing Node dependencies to be installed before converter build/export checks run.

The script checks:

- create deck: copies `themes/basic` to `/tmp/slidev-agent-platform-basic-smoke/basic` and verifies `slides.md`, `package.json`, and the local SVG asset
- publish: runs `slidev build slides.md --out dist` when `slidev` or `npx --no-install slidev` is available
- PPTX export: starts the same local Slidev CLI, exports with `bin/slidev-to-pptx.js`, and verifies with `bin/slidev-to-pptx-verify.js --slides 5 --scale 2`

If Slidev is not installed locally or on `PATH`, the script still validates the scaffold and builds the converter, then skips publish/export without downloading dependencies.

## App Shell

Run the product app smoke test:

```sh
scripts/smoke-app.sh
```

The script starts an isolated server using temp data under `/tmp`, disables `.env.local` loading so SMTP is not used, starts a fake OpenAI-compatible model endpoint for admin model-list checks, verifies the migration command is a safe no-op without `DATABASE_URL`, logs in through the dev magic-link response, creates a deck from `themes/commercial-profile`, verifies the commercial theme files were copied, creates a public client share link, verifies `/client/:token` serves the React client shell while legacy `/share/:token` routes still work, verifies an unrelated employee is denied until added as a viewer collaborator, and verifies the deck and live-preview APIs are auth-gated.

The admin-tools section checks component creation under `theme/components`,
layout creation under `theme/layouts`, dependency updates in `package.json`
without running install, invalid package-name rejection, live-preview restart,
per-deck deepagents model provider overrides, and the employee 403 boundary for
the same admin-only endpoints. The lock section verifies member instruction
guards reject filesystem and package-management requests before model execution.

The collaborator section checks add-by-email, enriched collaborator listing,
viewer access without edit locks, role upgrade to editor, removal revoking deck
access, and re-adding as editor for the later lock/edit checks.

The app smoke also runs with `DECKS_DOMAIN=decks.smoke.test` and checks that
`<deck-id>.decks.smoke.test` is auth-gated and serves the authenticated deck
preview through Express host routing.

`npm run smoke:supervisor` uses a fake preview runner to verify the process
supervisor passes deck-domain HMR settings (`wss`, client port `443`, and
`/__hmr`) to the Slidev runner, then checks capacity eviction, idle reaping, and
bounded crash retry after an unexpected preview-process exit.

`npm run smoke:exporter` uses fake built `slidev-to-pptx` and verifier CLIs to
check that PPTX exports are queued according to `EXPORT_CONCURRENCY`, that two
jobs run serially when concurrency is `1`, that interrupted queued/running jobs
are failed on startup, and that verifier slide/image counts are recorded on the
completed export job.

## Postgres auth smoke

`npm run smoke:postgres-auth` is opt-in and exits successfully without doing work
unless `DATABASE_URL` is set. When a database is available it applies migrations,
starts the server with Postgres-backed compatibility auth, verifies better-auth is
enabled, logs in the bootstrap admin through the current one-time-link API,
checks the login also sets `better-auth.session_token`, and checks logout clears
the database-backed session. When it runs against a real database it also checks
that the bootstrap admin was synced into the configured better-auth organization
as an org admin member.

## Auth bridge smoke

`npm run smoke:auth-bridge` does not require Postgres. It uses a fake pool to
verify that the API auth layer accepts signed `better-auth.session_token`
cookies, still accepts legacy `slidev_session` cookies, rejects tampered
better-auth cookies, and deletes both raw and hashed session-token forms on
logout.

## Security smoke

`npm run smoke:security` checks role-scoped agent guards, deepagents filesystem
permissions for member/admin roles, and fake deepagents v3 stream projection
mapping into token/tool/file SSE events.

## Auth organization smoke

`npm run smoke:auth-org` does not require Postgres. It uses a fake pool to verify
that compatibility bootstrap/invite writes the configured better-auth
`organization` row and deterministic `member` rows, mapping app admins to org
`admin` and employees to org `member`. It also checks that the deck store uses
the configured app org name/slug when resolving the Postgres `org_id` used by
deck records.

## Deepagents runtime smoke

`npm run smoke:deepagents` is opt-in and exits successfully without doing work
unless `RUN_DEEPAGENTS_SMOKE=true` is set. Use it against a real
OpenAI-compatible model provider at `AGENT_BASE_URL` to exercise deepagents.
