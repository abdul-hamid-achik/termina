# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Termina is a text-based multiplayer MOBA (5v5) played through a terminal-inspired browser UI. Frontend is Nuxt 4 + Vue 3 + Pinia 3 (Tailwind 4). Backend is Nitro with Effect-TS for the game engine, PostgreSQL via Drizzle, and Redis. The game runs on 4-second ticks with deterministic action resolution. Tooling is oxc-based: **oxlint** (lint), **oxfmt** (format), **knip** (dead-code), with lefthook git hooks. Runtime is Bun.

## Commands

```bash
# Dev server (do NOT use bun --bun flag — it breaks WebSocket proxy chain)
bun run dev

# Tests
bun run test:all          # LITERALLY EVERYTHING — pure package.json composition, NO scripts/ file:
                          #   test:db (PG+Redis + isolated termina_test + flush + schema) → all
                          #   Vitest projects → build → `start-server-and-test` boots ONE prod
                          #   server (serve:test) for hitspec (API) + cairntrace e2e (reuse), then
                          #   tears it down. ~12-15 min. Helpers: test:db / serve:test / test:server.
bun run test              # Vitest projects (run mode) + the e2e suite (does NOT include hitspec)
bun run test:watch        # Vitest watch mode (fast iteration)
bun run test:unit         # Unit tests (node env)
bun run test:gameplay     # In-process gameplay harness (node env) — seed scenario → act →
                          #   advance ticks → assert engine truth. NO browser/server/DB. Owns
                          #   "does this game situation resolve correctly" (tests/gameplay/).
bun run test:integration  # Integration tests (node env) — needs Postgres (docker compose up -d)
bun run test:e2e          # Cairntrace browser e2e (UI only). cairn's `webServer:`
                          #   config block (cairntrace >=1.11.0) builds + boots a PRODUCTION
                          #   PREVIEW server (node .output/server, IPv4, TERMINA_TEST_HOOKS=1)
                          #   on --cold-start, else reuses one on :3000. Replaces the old
                          #   scripts/e2e.mjs. Gameplay/engine truth now lives in test:gameplay.
bun run test:api          # API tests (hitspec, requires running server)
bun run test:coverage     # All vitest projects with v8 coverage; ENFORCES the thresholds
                          #   in vitest.config.ts (lines 78 / branches 69 / funcs 76 / stmts 76)
npx vitest run tests/unit/engine/GameLoop.test.ts  # Single test file
cairn run tests/e2e/flows/objectives_seeded.yml --config tests/e2e/cairntrace.config.yml --cold-start  # Single e2e flow

# Histoire — visual component workbench (heroes/items/menus/screens/components).
bun run story:dev         # Histoire dev server (interactive)
bun run story:build       # One-shot build (CI/advisory gate); story files are app/**/*.story.vue

# CI: .github/workflows/ci.yml runs on push/PR as parallel named jobs — lint, format,
# typecheck, knip, unit-tests, component-tests, integration-tests, build — gated by a
# `ci-success` aggregate (the single required check). e2e, stories (histoire build), and
# coverage (vitest v8) are ADVISORY (run + upload artifacts, but NOT in the ci-success
# gate yet). Postgres+Redis are started via `docker run` behind a pull-retry loop (NOT
# `services:`, which can't retry a transient Docker Hub pull failure). cairn is from github.

# Lint, format, typecheck, dead-code (oxc tooling — NOT eslint/prettier)
bun run lint              # oxlint
bun run format            # oxfmt --write   (format:check for CI)
bun run typecheck         # nuxt typecheck  (vue-tsc over the split Nuxt 4 tsconfigs)
bun run knip              # unused files/deps/exports

# Database (requires PostgreSQL via docker-compose).
# NOTE: the DB is `drizzle-kit push`-managed — schema.ts is the source of truth.
# Apply a schema change with `bun run db:push` (or direct SQL for index/dedupe).
# There are intentionally NO db:generate/db:migrate recipes — the file-migration
# history is vestigial/broken, so don't reintroduce them.
docker compose up -d      # Start PostgreSQL + Redis
bun run db:studio         # Drizzle Studio GUI

# Build
bun run build
bun run preview
```

## Architecture

### Game Loop Pipeline (server/game/engine/)

Each tick (4s) runs this pipeline in `processTick`:
1. Bot AI decides actions → `submitAction()`
2. Drain action queue (1 action per player per tick)
3. Validate actions via `validateAction()` — rejected ones return with reason
4. Resolve in phases: instant abilities → movement → attacks/casts → passives/cooldowns → buy/sell
5. CreepAI + TowerAI
6. Spawn waves, distribute gold, handle respawns, fountain healing, deaths, level ups
7. Check win condition
8. Broadcast vision-filtered state to each player via `filterStateForPlayer()`

### Effect-TS Service Pattern

Services use Effect's Context.Tag + Layer for dependency injection:
- `DatabaseService` — Drizzle ORM wrapper (PostgreSQL)
- `RedisService` — Pub/sub messaging
- `WebSocketService` — Connection tracking per game

The game server plugin (`server/plugins/game-server.ts`) composes layers into a `ManagedRuntime` that provides services to all game loop fibers.

### WebSocket Flow

Browser → Vite dev server → Nuxt CLI upgrade → Nitro DevServer → http-proxy → Worker (crossws/adapters/node)

`PeerRegistry` (`server/services/PeerRegistry.ts`) tracks player↔peer mappings. Use `crosswsPeer.send()` as primary (it properly delegates to underlying ws). The `rawWs` (peer.websocket Proxy) is a fallback only.

### State Flow (Client)

WebSocket messages → `useGameSocket` composable → routes to Pinia stores:
- `game.ts` store: tick state, player state, scoreboard, events
- `lobby.ts` store: queue status, hero picks, countdown
- `auth.ts` store: session via `nuxt-auth-utils`

`gameStore.playerId` = OAuth session user ID (e.g., `github_7379966`). This same ID is used as the key in `GameState.players` on the server.

### Map Topology

Zones are defined in `shared/constants/zones.ts` with `adjacentTo` arrays. Movement validation checks `areAdjacent()` — players can only move one zone per tick. Fountain is only adjacent to base.

### Vision System

`VisionCalculator.filterStateForPlayer()` computes visible zones per player (own zone + adjacent, wards, towers, allies). Enemies outside vision are returned as `FoggedPlayer` (minimal info only).

## Deployment

Production is a Vercel + DigitalOcean split (full runbook: `infra/README.md`):

- **Vercel** — the Nuxt frontend, plus the data layer (Neon Postgres + Upstash Redis) provisioned via the Vercel Marketplace
- **DigitalOcean App Platform** — the full Nitro server (SSR + WS + 4s-tick game loop) from a DOCR Docker image (`Dockerfile`, non-root runtime). Managed as **Pulumi (TypeScript) IaC in `infra/`** — isolated (own deps/tsconfig; excluded from app lint/typecheck/knip/Docker), so it never affects app CI gates
- **State backend** is self-managed: a DigitalOcean Spaces (S3-compatible) bucket pinned in `infra/Pulumi.yaml` `backend.url` (DO `pulumi login` not needed). Secrets via the default `passphrase` provider
- **Secrets** are managed locally with **tvault**, keyed by their real env-var names, so `tvault run -- pulumi up` (deploy) and `tvault run -- bun run dev` (local) both inject them. `infra/index.ts` reads each secret env-first, else Pulumi config. The DO Spaces keys (`AWS_*`) are distinct from the provider token (`DIGITALOCEAN_TOKEN`)
- CI `.github/workflows/deploy.yml` builds + pushes the image to DOCR (`registry.digitalocean.com`), then runs `pulumi up`

## Key Conventions

- **Immutable state updates**: Game state uses spread operators, never mutate in place
- **Effect.gen for async pipelines**: Server-side async uses Effect generators, not raw promises
- **Discriminated unions**: Protocol messages use `{ type: '...' }` discriminator
- **Unused vars**: Prefix with `_` (e.g., `_details`)
- **Type imports**: oxlint enforces `import type { ... }` (`typescript/consistent-type-imports`)
- **Imports**: server code uses the `~~/server/...` root alias, not `../../` (`~~` → repo root, `~`/`@` → `app/`); resolves in Nitro, vitest, and tsc
- **No `scripts/` folder / no orchestration scripts** (owner preference): there is NO `scripts/` directory — do NOT create one or add `*.mjs|*.ts` glue for builds/tests/servers. Compose behavior from `package.json` scripts (chained with `&&`, env inline) + config + a small idiomatic dev dep. E.g. "boot a server → wait → test → tear down" is `start-server-and-test 'bun run serve:test' <url> 'bun run …'`, NOT a custom runner — this is exactly why the old `scripts/e2e.mjs` → cairntrace `webServer` and why there is no `test-all.mjs`. The one standalone manual *tool* (a bot-match balance simulator) lives in the code as `server/game/dev/simulate-game.ts` — run it via `bun run sim [matches] [maxTicks]` (or directly with `bun server/game/dev/simulate-game.ts …`). With `matches>1` it prints a BALANCE SUMMARY (side win-rate + 2σ significance, length spread, per-hero win-rate with a `*` for win-rates beyond small-sample noise) via the unit-tested `server/game/dev/simStats.ts`. NOT in a `scripts/` folder.
- **Testing**: Vitest 4 for unit tests — projects live in `test.projects` in `vitest.config.ts` (`bun run test:unit|components|integration`), `vi.fn()` mocks, `describe/it`; hitspec for API tests (`.http` in `collections/`); Cairntrace BDD for E2E browser tests (`tests/e2e/`, YAML flows that drive the real app — register/log in through the UI, navigate, assert; NO test hooks. Game/engine truth lives in `bun run test:gameplay`. See the **End-to-end** section of `README.md`)
- **CSS theming**: Custom properties in `:root` (terminal.css), Tailwind 4 utilities extend them (e.g., `text-radiant`, `bg-bg-primary`, `text-dire`). Tailwind 4 is wired via `@tailwindcss/vite` + an `@config` directive in terminal.css that keeps the v3-style `tailwind.config.ts` theme

## Important Gotchas

- **Never use `bun --bun nuxt dev`** — Bun's native HTTP breaks the WebSocket proxy chain in dev mode
- **Font imports** go in `app/assets/css/terminal.css` via `@import`, not in `nuxt.config.ts` `css` array (prevents SSR 404s)
- **`<ClientOnly>`** is needed around auth-conditional UI in layouts (Nuxt 4 loads layouts async, causing hydration mismatches)
- **`processTick` validates actions twice** — once in GameLoop (line 88) and once inside `resolveActions`. The GameLoop validation catches rejections for player feedback; the ActionResolver validation is a safety net
- **Bot IDs** start with `bot_` prefix — checked via `isBot()` from BotManager
- **Lobby cleanup** happens in `game-server.ts` after game creation, not in lobby.ts — prevents race condition where poll returns 'searching' between lobby end and game start
- **knip config is `knip.config.ts`, NOT `knip.json`** — knip resolves `knip.json` first, so adding one shadows the tuned config and explodes findings. Unused exports/types are advisory `warn`; unused files/deps fail the gate
- **oxfmt formats everything by default** — its `.oxfmtrc.json` `ignorePatterns` MUST exclude `tests/e2e/**` (stamped cairntrace YAML — reformatting breaks the contractHash), `server/db/migrations/**`, and `**/*.{md,yml,yaml}`
- **Type augmentations go in `shared/types/*.d.ts`** (e.g. the `#auth-utils` `User` augmentation) — Nuxt 4's split tsconfigs don't load `server/types/*.d.ts` as global augmentations, but `shared/**/*.d.ts` is in both the app and server include
- **`players` and `hero_stats` both have `games_played` + `wins`** — bare column refs in a join/upsert are ambiguous in Postgres; qualify them (e.g. `hero_stats.games_played` in `ON CONFLICT DO UPDATE`)
- **vue-router stays aligned with Nuxt's requirement** — Nuxt 4.4.8 requires `vue-router@5` for the `vue-router/volar/sfc-route-blocks` plugin; pinning v4 reintroduces `ERR_PACKAGE_PATH_NOT_EXPORTED` during `vue-tsc`
- **Histoire is PINNED to `1.0.0-beta.1`** (`histoire` + `@histoire/plugin-vue`) — the only line that supports Vite 7 (what Nuxt 4 ships); the default "latest stable" 0.17.x does NOT. Do not switch to a `^` range. It renders components in a standalone (non-Nuxt) Vite runtime, so `histoire.setup.ts` installs Pinia + stubs `<NuxtLink>`/global `navigateTo`, and `histoire.config.ts` adds `@vitejs/plugin-vue` + `@tailwindcss/vite` + the `~`/`~~`/`@` aliases and imports `terminal.css`. Story files are `app/**/*.story.vue`; shared mock factories live in `app/stories/fixtures.ts`; store-coupled stories seed via the store's refs/`updateFromTick`. Histoire's builtin `tailwind-tokens` plugin logs a HARMLESS non-fatal `[Plugin:builtin:tailwind-tokens]` error (it calls Tailwind v3's `resolveConfig`, gone in v4) — ignore it; the build still exits 0. `app/**/*.story.vue` + `histoire.config.ts`/`histoire.setup.ts` are knip entries; `.histoire/` is gitignored
- **Coverage thresholds are ENFORCED** by `bun run test:coverage` (v8) at lines 78 / branches 69 / functions 76 / statements 76 in `vitest.config.ts` — set just under the achieved actuals (lines ~79 / branches ~70.5 / funcs ~77.4 / stmts ~77.6); raise as coverage climbs, never above what's earned
