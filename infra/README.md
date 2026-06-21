# Termina — Infrastructure (Pulumi + DigitalOcean)

Production deployment for Termina, split across **Vercel** (frontend + data) and
**DigitalOcean** (the game server), with the DigitalOcean side managed as code
by **Pulumi (TypeScript)** and local secrets managed by **[tvault](https://github.com/abdul-hamid-achik/tinyvault)**.

> This directory is an isolated Pulumi project: its own `package.json`,
> `tsconfig.json`, and `node_modules`. It is excluded from the app's lint /
> typecheck / knip / Docker build, so it never affects the game's CI gates.

## What runs where, and why

```
                 ┌─────────────────────────── Vercel ───────────────────────────┐
   browser ─────▶│  Nuxt frontend (SSR shell + client SPA, CDN, TLS)             │
                 │  Vercel Marketplace ─▶ Neon Postgres   +   Upstash Redis      │
                 └───────────────────────────┬──────────────────┬───────────────┘
                          wss:// + https://   │   connection     │ connection
                                              │   strings        │ strings
                 ┌────────────────────────────▼──────────────────▼───────────────┐
   browser ─wss─▶│  DigitalOcean App Platform — full Nitro server                 │
                 │  SSR + WebSocket + Effect-TS game loop (4s ticks) + API        │
                 │  Docker image from DOCR · /api/health · auto TLS + rolling deploy│
                 └───────────────────────────────────────────────────────────────┘
```

- **Vercel** serves the static/SSR frontend (fast global CDN) **and** provisions
  the **data layer** through the Vercel Marketplace: **Neon** (serverless
  Postgres) and **Upstash** (serverless Redis). Those integrations hand you two
  connection strings — `NUXT_DATABASE_URL` and `NUXT_REDIS_URL` — which the DO
  server consumes. This stack does **not** own Neon/Upstash.
- **DigitalOcean App Platform** runs the one stateful thing that can't be
  serverless: the long-lived **WebSocket + in-process game loop**. It pulls the
  Docker image (built from the repo `Dockerfile`) from **DOCR** and exposes one
  HTTP port (3000) that also carries the WS upgrade.

### Why App Platform (and the path off it)

The game loop runs **in-process** and game state is **in-memory per instance**,
so a game is pinned to the instance that owns it. The Redis relay
(`game_owner` / `player_location` / action queue, all already in the codebase)
keeps **multiple instances correct** — a reconnect or cross-instance action is
routed to the owning instance — even without sticky sessions (worst case is one
extra hop, not breakage).

That makes **App Platform** the right first call: lowest ops, native TLS, health
checks, and rolling deploys, with `instanceCount`/`instanceSize` as the scaling
knobs. **Scale up before out** (bump `instanceSize`), then out (`instanceCount`).
Because this stack defines *only* the compute layer, you can later swap it for
**Droplets + a DO Load Balancer** (cookie-based sticky sessions) or **DOKS**
without touching the data or secret model — just rewrite `index.ts`'s resources.

## Go-live checklist

End-to-end sequence to take this to production. Each step is detailed in a
section below.

1. **Vercel — data layer**: provision Neon Postgres + Upstash Redis via the
   Vercel Marketplace. Copy `NUXT_DATABASE_URL` (use the **pooled** Neon string —
   `prepare:false` is already set for its PgBouncer pooler) and `NUXT_REDIS_URL`
   (`rediss://`).
2. **Vercel — frontend**: deploy the Nuxt app (leave `NUXT_PUBLIC_*` unset for now).
3. **DO — Spaces**: create a Spaces access-key pair, then the state bucket +
   versioning (see [Self-managed state backend](#self-managed-state-backend-digitalocean-spaces)).
4. **Secrets — tvault**: store `NUXT_*`, `DIGITALOCEAN_TOKEN`, the Spaces `AWS_*`
   keys, and `PULUMI_CONFIG_PASSPHRASE` (see [Secrets with tvault](#secrets-with-tvault)).
5. **Pulumi — first init (local)**: `cd infra && npm install && tvault run --
   pulumi stack init prod`. This validates the backend URL — if it errors on
   bucket addressing, append `&s3ForcePathStyle=true` to `Pulumi.yaml`.
6. **First deploy**: `tvault run -- pulumi up` (or push to `main` once the GitHub
   secrets in [CI](#ci) are set).
7. **Wire the frontend**: set Vercel `NUXT_PUBLIC_API_URL` = `pulumi stack output
   vercelApiUrl` and `NUXT_PUBLIC_WS_URL` = `pulumi stack output vercelWsUrl`;
   redeploy Vercel.
8. **Lock down CORS**: set `NUXT_CORS_ALLOWED_ORIGINS` (on the DO side) to the
   Vercel origin — until then the API echoes any origin.
9. **Alerts**: set a team notification email in the DO console (alerts are
   pre-declared — see [Alerts](#alerts)).
10. **Smoke test**: `curl https://<app>/api/health` → `{"status":"ok",…}`, then
    connect a client and confirm a game starts and ticks.

**Before heavy traffic — open hardening items:**

- **Graceful shutdown** on SIGTERM — **implemented** (`game-server.ts` close
  hook): flushes a faithful final snapshot per live game (threaded meta, so
  resume works) + releases the game-ownership claim, bounded to 5s + best-effort
  (falls back to the ≤60s periodic snapshot on any failure — no worse than
  before). Review the diff and validate against a real rolling deploy before
  relying on it (it can't be exercised locally).
- **Rate-limit budgets**: a per-IP WS connection cap and OAuth-callback limits are
  not yet wired (per-player WS limits, public-read IP limits, and WS recovery
  limits are). Tune if abuse appears.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/). The state backend is a
  **self-managed DigitalOcean Spaces** bucket pinned in `Pulumi.yaml` (see
  below) — no `pulumi login` needed once it's committed.
- A **DigitalOcean** account + API token, a **DOCR** registry (the `do-build`
  CI job pushes `termina-ws` there), and a **Spaces** access-key pair (DO console
  ▸ API ▸ Spaces Keys) for the state backend.
- **tvault** for local secrets: `brew install abdul-hamid-achik/tap/tvault`.
- Node 18+ (`npm install` inside this directory pulls the Pulumi SDKs).

## Self-managed state backend (DigitalOcean Spaces)

Pulumi state lives in a private Space (`termina-pulumi-state`, region `nyc3`), not
Pulumi Cloud. `infra/Pulumi.yaml` pins it:

```yaml
backend:
  url: 's3://termina-pulumi-state?endpoint=nyc3.digitaloceanspaces.com&region=us-east-1'
```

- `endpoint=` is the Spaces regional hostname (no scheme; TLS on by default).
  `region=us-east-1` is a dummy the AWS SDK requires — Spaces ignores the value.
- Auth uses the standard AWS env vars holding a **Spaces** key pair — these are
  **separate** from `DIGITALOCEAN_TOKEN` (which the provider uses to create
  resources): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-1`.
- Secrets use the default **passphrase** provider, so `PULUMI_CONFIG_PASSPHRASE`
  must be present for `stack init` / `config set --secret` / `up`.
- DO Spaces is virtual-hosted, so `s3ForcePathStyle`/`disableSSL` are not set. If
  the first local `pulumi stack init` errors on bucket addressing, append
  `&s3ForcePathStyle=true` to the URL (do **not** also add `awssdk=v2` — they're
  incompatible). Validate locally before CI relies on it.

### One-time bucket bootstrap (doctl can't create Spaces buckets)

```bash
export AWS_ACCESS_KEY_ID="<spaces-access-key>"
export AWS_SECRET_ACCESS_KEY="<spaces-secret-key>"
export AWS_REGION="us-east-1"

# Create the private state bucket (region nyc3 — match the backend URL endpoint):
aws s3api create-bucket --bucket termina-pulumi-state \
  --endpoint-url https://nyc3.digitaloceanspaces.com

# Enable versioning (recovers clobbered/destroyed state; the S3 API is the only
# way Spaces exposes this toggle):
aws s3api put-bucket-versioning --bucket termina-pulumi-state \
  --endpoint-url https://nyc3.digitaloceanspaces.com \
  --versioning-configuration Status=Enabled
```

## Secrets with tvault

All secrets are keyed by their **real environment-variable names**, so a single
tvault project drives both local dev and deploys — no plaintext `.env`, nothing
in shell history.

```bash
# One-time: create the project and store secrets (values stay encrypted at rest).
tvault projects create termina -d "Termina runtime + deploy secrets"
tvault use termina

# App runtime secrets (also used by `tvault run -- bun run dev` locally):
tvault set NUXT_SESSION_PASSWORD "$(openssl rand -hex 24)"
tvault set NUXT_DATABASE_URL "postgresql://…neon…"     # from Vercel ▸ Neon
tvault set NUXT_REDIS_URL    "rediss://…upstash…"       # from Vercel ▸ Upstash
tvault set NUXT_OAUTH_GITHUB_CLIENT_ID "…"
tvault set NUXT_OAUTH_GITHUB_CLIENT_SECRET "…"
tvault set NUXT_OAUTH_DISCORD_CLIENT_ID "…"
tvault set NUXT_OAUTH_DISCORD_CLIENT_SECRET "…"

# DigitalOcean API token — Pulumi's DO provider reads it from the env:
tvault set DIGITALOCEAN_TOKEN "dop_v1_…"

# Self-managed backend creds — the DO Spaces key pair + the secrets passphrase:
tvault set AWS_ACCESS_KEY_ID "<spaces-access-key>"
tvault set AWS_SECRET_ACCESS_KEY "<spaces-secret-key>"
tvault set AWS_REGION "us-east-1"
tvault set PULUMI_CONFIG_PASSPHRASE "$(openssl rand -hex 24)"

# Already have a local .env? Import it in one shot instead of the sets above:
#   tvault import .env
```

Then **every** command that needs secrets is just wrapped in `tvault run --`:

```bash
tvault run -- bun run dev        # local dev with secrets injected
tvault run -- pulumi up          # deploy: DO token + NUXT_* injected as env
```

`index.ts` resolves each secret **env-var-first, then Pulumi config** — so the
tvault-injected env vars are picked up automatically and wrapped in
`pulumi.secret()` (encrypted in state). If you'd rather not use tvault, set them
the classic way: `pulumi config set --secret termina-infra:databaseUrl …`.

> Note: a running `tvault mcp` server holds an exclusive lock on `~/.tvault/vault.db`.
> If a `tvault` CLI command hangs/times out, stop that server first (or run the
> commands through the MCP-connected agent).

## Deploy

The backend is resolved from `Pulumi.yaml` (no `pulumi login` needed). Do the
one-time bucket bootstrap (above) first, then:

```bash
cd infra
npm install
tvault run -- pulumi stack init prod    # first time only (writes state into the Space)
tvault run -- pulumi stack select prod

# (set createRegistry=true the first time if Pulumi should own the DOCR registry)
tvault run -- pulumi up
```

The deployed image version is `termina-infra:imageTag` (default `latest`). For
immutable deploys, have CI push `:<git-sha>` to DOCR, then:

```bash
pulumi config set termina-infra:imageTag "$GIT_SHA"
tvault run -- pulumi up
```

### Wire the frontend to the server

After `pulumi up`, read the outputs and set them on the Vercel project:

```bash
pulumi stack output vercelApiUrl   # -> NUXT_PUBLIC_API_URL (https://…)
pulumi stack output vercelWsUrl    # -> NUXT_PUBLIC_WS_URL   (wss://…)
```

## CI

`.github/workflows/deploy.yml` builds + pushes the image to DOCR, then runs
`pulumi up` (replacing the old `doctl apps update --spec` step) via the Pulumi
CLI, deploying the freshly-built `:<git-sha>` image. Required **GitHub secrets**:

| Secret | Maps to env | Purpose |
| --- | --- | --- |
| `SPACES_ACCESS_KEY_ID` | `AWS_ACCESS_KEY_ID` | DO Spaces key — state backend |
| `SPACES_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY` | DO Spaces secret — state backend |
| `PULUMI_CONFIG_PASSPHRASE` | (same) | secrets-provider passphrase |
| `DIGITALOCEAN_ACCESS_TOKEN` | `DIGITALOCEAN_TOKEN` | DO provider (already present) |
| `NUXT_SESSION_PASSWORD`, `NUXT_DATABASE_URL`, `NUXT_REDIS_URL` | (same) | app runtime secrets (`index.ts` reads env-first) |

The `prod` stack must be initialized in the Space (a one-time local
`pulumi stack init prod`) **before** the first CI run. `.github/do-app-spec.yaml`
and the `DO_APP_ID` secret are no longer used by this path.

## Alerts

The App declares ops alerts in `index.ts` (no extra setup): app-level
`DEPLOYMENT_FAILED` / `DOMAIN_FAILED`, plus per-service `RESTART_COUNT > 3` and
`MEM_UTILIZATION > 90%` over a 5-minute window. With no `destinations` block they
notify the DO team's default email — set a team notification email in the DO
console (or add a `destinations` block with `emails` / `slackWebhooks`).

## Config reference

| Key (`termina-infra:`) | Default        | Notes                                            |
| ---------------------- | -------------- | ------------------------------------------------ |
| `region`               | `nyc`          | DO region slug.                                  |
| `appName`              | `termina-ws`   | App Platform app name.                            |
| `instanceCount`        | `1`            | Scale **out**. Multi-instance is Redis-safe.      |
| `instanceSize`         | `basic-xxs`    | Scale **up** first.                              |
| `imageRepository`      | `termina-ws`   | DOCR repository.                                 |
| `imageTag`             | `latest`       | Set to a git SHA for immutable deploys.          |
| `registryName`         | `termina`      | DOCR registry name.                              |
| `createRegistry`       | `false`        | `true` ⇒ Pulumi creates/owns the DOCR registry.  |
| `registryTier`         | `basic`        | `starter` \| `basic` \| `professional`.          |
| `createProject`        | `false`        | `true` ⇒ group the App under a named DO Project.  |
| `projectName`          | `termina`      | DO Project name (when `createProject`).          |
| `projectEnvironment`   | `Production`   | `Development` \| `Staging` \| `Production`.       |

Secrets (env-first, else Pulumi config): `sessionPassword`, `databaseUrl`,
`redisUrl`, and optional `githubClientId` / `githubClientSecret` /
`discordClientId` / `discordClientSecret`.

## Teardown

```bash
tvault run -- pulumi destroy   # tears down the DO App (and registry if Pulumi owns it)
```

Neon/Upstash are removed from the Vercel dashboard (Marketplace integrations),
not here.
