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
4. **Secrets — tvault** (`tvault use termina`): store `NUXT_*`, `DIGITALOCEAN_TOKEN`,
   and the Spaces `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`.
   (`PULUMI_CONFIG_PASSPHRASE` is **already generated + stored**; the `ci` identity
   + `TVAULT_IDENTITY_KEY` GitHub secret are **already set up**.)
5. **Pulumi — first init (local)**: `cd infra && npm install && tvault run --
   pulumi stack init prod`. This validates the backend URL — if it errors on
   bucket addressing, append `&s3ForcePathStyle=true` to `Pulumi.yaml`.
6. **Seal deploy secrets for CI**: `tvault -p termina seal --recipient <ci-public>
   --out infra/.env.encrypted && git add infra/.env.encrypted && git commit` (the
   commit-safe ciphertext CI decrypts — see [CI](#ci)). Re-seal when a secret changes.
7. **First deploy**: `tvault run -- pulumi up` locally, or push to `main` (CI deploys
   via the sealed file + `TVAULT_IDENTITY_KEY`).
8. **Wire the frontend** (same-origin API proxy — default, recommended): **leave
   `NUXT_PUBLIC_API_URL` empty** and set `NUXT_PUBLIC_WS_URL` = `pulumi stack
   output vercelWsUrl`. The browser then calls `www/api/...` first-party and
   `vercel.json` `rewrites` forward it to the DO server (no CORS, no
   cross-origin cookie). Ensure **`NUXT_SESSION_PASSWORD` is byte-identical on
   Vercel and DO** — OAuth seals the session cookie on Vercel and DO must
   unseal it (and vice-versa for credentials login). Redeploy Vercel.
   _(Direct cross-origin fallback: set `NUXT_PUBLIC_API_URL` = `vercelApiUrl`
   AND `NUXT_SESSION_COOKIE_DOMAIN=.terminamoba.com` on **both** sides — the
   client then calls `api.terminamoba.com` directly with credentials and a
   shared-domain cookie; the CORS allowlist below becomes load-bearing.)_
9. **Lock down CORS** (only load-bearing in the cross-origin fallback): set
   `NUXT_CORS_ALLOWED_ORIGINS` (on the DO side) to the Vercel origin — until
   then the API echoes any origin. Harmless to set under the proxy model.
10. **Alerts**: set a team notification email in the DO console (alerts are
    pre-declared — see [Alerts](#alerts)).
11. **Smoke test**: `curl https://<app>/api/health` → `{"status":"ok",…}`, then
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

tvault ≥ 0.12.0 niceties: `tvault run --only DIGITALOCEAN_TOKEN,NUXT_DATABASE_URL,…
-- pulumi up` injects just the keys the deploy needs (least-privilege); or push
secrets into Pulumi's own config with `tvault env --format pulumi-config --stack
prod | sh`. For CI, share the deploy project with a `ci` identity and run
`tvault run --identity ci -- pulumi up` (one `TVAULT_IDENTITY_KEY`, no per-secret
GitHub secrets) — see tvault's Pulumi & CI/CD guides.

> **tvault ≥ 0.12.0**: a running `tvault mcp` server now coexists with the CLI
> (reopen-per-request) — CLI commands no longer block on it. If an mcp process
> started by an older build is still running, restart it to pick up 0.12.0; until
> then the CLI reports `vault is locked by another tvault process` and you can
> stop that process or read via `tvault agent start`.

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

After `pulumi up`, read the outputs and set them on the Vercel project. Under
the default same-origin proxy, only `NUXT_PUBLIC_WS_URL` is set (the HTTP API is
proxied via `vercel.json`, so `NUXT_PUBLIC_API_URL` stays empty):

```bash
pulumi stack output vercelWsUrl    # -> NUXT_PUBLIC_WS_URL   (wss://…)
# pulumi stack output vercelApiUrl # -> NUXT_PUBLIC_API_URL only for the direct
#                                  #    cross-origin fallback (see step 8)
```

The proxy target host in `vercel.json` (`rewrites[0].destination`) must match
the App's custom domain (`api.terminamoba.com`); update it if the domain changes.

## CI

`.github/workflows/deploy.yml` builds + pushes the image to DOCR, then runs
`pulumi up`, deploying the freshly-built `:<git-sha>` image. Deploy secrets use
**tvault identity mode** (passphrase-free): the deploy secrets are
recipient-sealed into a committed `infra/.env.encrypted` (sealed to the `ci`
identity), and CI decrypts it with a single secret — no per-secret GitHub secrets,
no vault passphrase in CI.

**GitHub secrets** (the only ones the deploy job needs):

| Secret | Purpose |
| --- | --- |
| `TVAULT_IDENTITY_KEY` | the `ci` identity's private key (`tvault-key1…`); decrypts `infra/.env.encrypted`. **Already set.** |
| `DIGITALOCEAN_ACCESS_TOKEN` | `doctl registry login` for the image push (build step). |
| `DO_REGISTRY_NAME` | DOCR registry name for the image path. |

**The sealed deploy secrets** live in the tvault `termina` project and get sealed
into `infra/.env.encrypted`: `DIGITALOCEAN_TOKEN` (Pulumi provider), `AWS_ACCESS_KEY_ID`
/ `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` (Spaces backend), `PULUMI_CONFIG_PASSPHRASE`
(already generated + stored), and `NUXT_SESSION_PASSWORD` / `NUXT_DATABASE_URL` /
`NUXT_REDIS_URL` (+ optional OAuth).

**One-time, after you've stored the real secrets in the vault** (`tvault use termina`):

```bash
# seal the whole termina project to the ci identity → commit-safe ciphertext
tvault -p termina seal --recipient <ci-public-tvault1…> --out infra/.env.encrypted
git add infra/.env.encrypted && git commit -m "chore(deploy): seal ci deploy secrets"
```

Re-run that `seal` + commit whenever a deploy secret changes. The `prod` stack must
also be initialized in the Space (a one-time local `pulumi stack init prod`) before
the first CI run. `.github/do-app-spec.yaml` and `DO_APP_ID` are no longer used.

> Local deploys don't need the sealed file — just `tvault run -- pulumi up`.

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
