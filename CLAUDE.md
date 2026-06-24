# Termina — Agent & Contributor Guide

> **`CLAUDE.md` and `AGENTS.md` are kept identical.** Claude Code reads `CLAUDE.md`; other agent tools read `AGENTS.md`. Edit one, then copy it to the other (`cp CLAUDE.md AGENTS.md`) so they never drift.

This file provides guidance to Claude Code (claude.ai/code) and any other AI/contributor working in this repository.

## What This Is

Termina is a text-based multiplayer MOBA (5v5) played through a terminal-inspired browser UI. Frontend is Nuxt 4 + Vue 3 + Pinia 3 (Tailwind 4). Backend is Nitro with Effect-TS for the game engine, PostgreSQL via Drizzle, and Redis. The game runs on 4-second ticks with deterministic action resolution. Tooling is oxc-based: **oxlint** (lint), **oxfmt** (format), **knip** (dead-code), with lefthook git hooks. Runtime is Bun.

## Commands

```bash
# Dev server (do NOT use bun --bun flag — it breaks WebSocket proxy chain).
# For OAuth + DB/Redis locally, inject the LOCAL secret set:
#   tvault -p termina-local run -- bun run dev   (see Deployment → Secrets)
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
cairn run tests/e2e/flows/profile_view.yml --config tests/e2e/cairntrace.config.yml --cold-start  # Single e2e flow

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

- **Vercel** — the Nuxt frontend, plus the data layer (Neon Postgres + Upstash Redis) provisioned via the Vercel Marketplace. Browser → `www.terminamoba.com`; HTTP `/api/*` is proxied to DO via `vercel.json` `rewrites` (same-origin, first-party cookie). WebSockets connect directly to DO (`NUXT_PUBLIC_WS_URL`)
- **DigitalOcean App Platform** — the full Nitro server (SSR + WS + 4s-tick game loop + API) at `api.terminamoba.com`, from a DOCR Docker image (`Dockerfile`, non-root runtime). Managed as **Pulumi (TypeScript) IaC in `infra/`** — isolated (own deps/tsconfig; excluded from app lint/typecheck/knip/Docker), so it never affects app CI gates. OAuth runs here; `redirect_uri` is forced to the www frontend via `NUXT_OAUTH_*_REDIRECT_URL` (behind the proxy DO sees `Host: api.*`, so it must be pinned)
- **State backend** is self-managed: a DigitalOcean Spaces (S3-compatible) bucket pinned in `infra/Pulumi.yaml` `backend.url` (DO `pulumi login` not needed). Secrets via the default `passphrase` provider
- **Secrets** are managed locally with **tvault**, keyed by their real env-var names, in **two projects**: `termina` holds the PROD secrets (deploy: `tvault -p termina run -- pulumi up`; www-callback OAuth apps + Neon/Upstash) and `termina-local` holds LOCAL dev secrets (run: `tvault -p termina-local run -- bun run dev`; localhost-callback GitHub OAuth app + docker Postgres/Redis). Always pass `-p` — bare `tvault run` uses the current project and can inject prod creds (incl. the prod DB) into local dev. `infra/index.ts` reads each secret env-first, else Pulumi config. The DO Spaces keys (`AWS_*`) are distinct from the provider token (`DIGITALOCEAN_TOKEN`)
- **Auth invariant**: `NUXT_SESSION_PASSWORD` must be byte-identical on Vercel and DO (the session cookie seal must be mutually decryptable). Vercel only needs `NUXT_SESSION_PASSWORD` + `NUXT_PUBLIC_WS_URL` (+ the Neon/Upstash integration vars); the rest of the backend secrets live only on DO
- CI `.github/workflows/deploy.yml` builds + pushes the image to DOCR (`registry.digitalocean.com`), then runs `pulumi up` (triggered via `workflow_run` after CI succeeds on main)

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

## Agent Roles

Specialized roles for working on the Termina codebase — ownership + key files per area. Pick the role that matches the change.

### game-engine

Expert in the server-side game loop and combat systems.

**Owns**: `server/game/engine/`, `shared/constants/balance.ts`

**Key files**:

- `GameLoop.ts` — tick pipeline, `processTick`, `submitAction`, `buildGameLoop`
- `ActionResolver.ts` — `validateAction`, `resolveActions` (phase-ordered: instant → move → attack → passive → buy)
- `StateManager.ts` — `createPlayerState`, `createInitialGameState`, in-memory Effect service
- `VisionCalculator.ts` — `filterStateForPlayer`, fog-of-war per team
- `DamageCalculator.ts` — physical/magical/pure damage formulas
- `CombatResolver.ts` — `resolvePhysicalHit` unified NPC→hero damage path (wraps `_base.dealDamage`); `computeBladeMailReflect` single reflect formula
- `StateDelta.ts` — per-player tick_state delta compression (reference-equality field diff)
- `GoldDistributor.ts` — passive gold, kill bounties, last-hit rewards
- `CreepAI.ts`, `TowerAI.ts` — NPC behavior each tick
- `NeutralAI.ts` — neutral creep spawning in jungle, attacking heroes
- `RoshanAI.ts` — Roshan attacks, death handling, aegis drops
- `RuneAI.ts` — rune spawning, buffs, pickup

**Mechanics**:

- Glyph/Fortification — team-wide tower invulnerability (5 tick duration, 300 tick cooldown). Command: `glyph`. Key files: ActionResolver.ts (glyph phase), GameLoop.ts (expiration)
- Day/Night Cycle — time-based vision system (Day: 300 ticks, Night: 240 ticks, night vision penalty: -1 zone). Key files: GameLoop.ts (time progression), VisionCalculator.ts (penalty)
- TP Scroll Channeling — teleport with interrupt (2 tick channel, cancels on damage/movement). Key files: \_base.ts (channeling completion), ActionResolver.ts (cancellation)
- Sentry Wards — true sight mechanic, reveals invisible units (75g cost, 240 tick duration). Key files: VisionCalculator.ts (true sight), zones.ts (ward types)
- Aegis Resurrection — instant revive at death location with full HP/MP. Key files: GameLoop.ts (aegis check in handleDeaths)

**Conventions**: Immutable state updates via spread. All engine functions return `Effect.Effect<...>`. Game state is `Record<string, PlayerState>` keyed by playerId. One action per player per tick.

### hero-designer

Expert in hero definitions, abilities, and game balance.

**Owns**: `server/game/heroes/`, `shared/constants/heroes.ts`, `shared/types/hero.ts`

**Key files**:

- `shared/constants/heroes.ts` — `HEROES` registry, `HERO_IDS` list
- `server/game/heroes/_base.ts` — `levelUpHero`, `processDoTs`, `tickAllBuffs`
- `server/game/heroes/<name>.ts` — individual hero definitions (18 heroes)

**Balance ranges**: HP 400–800, MP 150–400, attack 30–70, defense 2–6 (tanks up to 8), magicResist 12–25. Abilities have cooldownTicks, manaCost, effects array with damage/heal/stun/silence/root/slow/shield/dot/buff/debuff/teleport/reveal/taunt/fear/execute types.

**Mechanics constants** (balance.ts): GLYPH_DURATION_TICKS = 5, GLYPH_COOLDOWN_TICKS = 300, DAY_DURATION_TICKS = 300, NIGHT_DURATION_TICKS = 240, NIGHT_VISION_PENALTY = 1, SENTRY_WARD_DURATION_TICKS = 30.

### frontend

Expert in the Vue 3 game UI, stores, and WebSocket integration.

**Owns**: `app/`

**Key files**:

- `composables/useGameSocket.ts` — WebSocket lifecycle, auto-reconnect, message routing
- `composables/useCommands.ts` — command parsing (`move`, `attack`, `cast`, `buy`, etc.) and autocomplete
- `composables/useServerUrl.ts` — resolves the WS origin (`useWsOrigin`) + the same-origin/cross-origin API fetch transform (`rewriteApiRequest`); paired with `app/plugins/api-origin.client.ts`
- `stores/game.ts` — `updateFromTick`, player state, scoreboard, events
- `stores/lobby.ts` — queue flow (idle → searching → found → picking → starting)
- `stores/auth.ts` — session via `nuxt-auth-utils`; OAuth via `navigateTo('/api/auth/<provider>', { external: true })`
- `components/game/GameScreen.vue` — main game layout, command handling, map/log/hero panels
- `components/game/AsciiMap.vue` — zone grid with player/ally/enemy markers
- `pages/lobby.vue` — matchmaking + hero picker + polling fallback

**Conventions**: Terminal-themed UI. CSS vars in `assets/css/terminal.css`. Tailwind 4 (wired via `@tailwindcss/vite` + an `@config` directive that keeps the v3-style `tailwind.config.ts` theme) utility classes using custom colors (`text-radiant`, `text-dire`, `text-self`, `bg-bg-primary`). `<ClientOnly>` required around auth-conditional rendering.

### matchmaking

Expert in the queue, lobby, and hero pick systems.

**Owns**: `server/game/matchmaking/`, `server/api/queue/`

**Key files**:

- `queue.ts` — `joinQueue`, `leaveQueue`, `startMatchmakingLoop` (Redis sorted set by MMR)
- `lobby.ts` — `createLobby`, `pickHero`, `confirmPick`, `startReadyCheck`, `currentPickTurn` (snake pick order). (`seedDraftLobby` is now dead code — it backed the removed `/api/test/new-draft` hook; left in place for a future draft-seed harness.)
- `server/api/queue/join.post.ts`, `status.get.ts`, `pick.post.ts` — HTTP endpoints

**Flow**: Queue → match found → lobby created → snake hero picks (15s per pick, auto-random on timeout) → 1.5s delay → 3s countdown → `game_ready` published to Redis → game-server.ts creates game. (No ban phase.) On lobby reconnect, `ws.ts` re-sends both `lobby_state` AND `pick_turn` so a refreshing/seeded client recovers whose turn it is.

### services

Expert in Effect-TS services, WebSocket infrastructure, and the plugin lifecycle.

**Owns**: `server/services/`, `server/plugins/game-server.ts`, `server/routes/ws.ts`

**Key files**:

- `PeerRegistry.ts` — `registerPeer`, `unregisterPeer`, `sendToPeer` (crosswsPeer primary, rawWs fallback)
- `WebSocketService.ts` — per-game connection tracking via Effect Layer
- `RedisService.ts` — pub/sub with `ioredis`, Effect-wrapped
- `DatabaseService.ts` — Drizzle ORM queries (players, matches, hero stats). DB is `drizzle-kit push`-managed — `schema.ts` is the source of truth; apply schema changes with `bun run db:push`. The file-migration history is vestigial, so there are no `db:generate`/`db:migrate` recipes. `players` and `hero_stats` both have `games_played`/`wins`, so qualify those columns in joins/upserts
- `ws.ts` — WebSocket handler: auth (via a session-minted ticket from `/api/auth/ws-ticket`), message dispatch, reconnect with 60s grace window
- `game-server.ts` — `ManagedRuntime` composition, Redis subscription for `game_ready`, game loop callbacks

**Pattern**: Services use `Context.Tag` + `Layer.succeed` for DI. The `ManagedRuntime` provides layers to all game loop fibers. Bot filtering via `isBot()` prevents sending messages to bot players.

### tester

Expert in writing and maintaining Vitest (unit/integration/component) and Cairntrace (browser E2E) tests.

**Owns**: `tests/`

**Key files**:

- `tests/unit/engine/` — GameLoop, ActionResolver, StateManager, VisionCalculator, DamageCalculator
- `tests/unit/heroes/` — per-hero stat and ability validation
- `tests/unit/services/` — PeerRegistry, WebSocketService, protocol
- `tests/unit/matchmaking/` — queue, lobby (+ `seed-draft-lobby`)
- `tests/unit/stores/` — game store, lobby store
- `tests/unit/composables/` — useGameSocket, useCommands, useAudio, useServerUrl
- `tests/e2e/` — **Cairntrace** YAML flows that drive the REAL app (register/log in through the UI, navigate, assert); NO test seed hooks. `flows/`, reusable `actions/login.yml`, `cairntrace.config.yml`. Game/engine truth lives in `tests/gameplay/` (`bun run test:gameplay`). See the **End-to-end** section of the root `README.md`.

**Patterns**: Vitest 4 — projects are in `test.projects` in `vitest.config.ts`. `vi.fn()` mocks; `vi.mock()` for modules (PeerRegistry, BotManager); `vi.useFakeTimers()`; `Effect.runSync` for Effect code. NOTE vitest 4: `new (vi.fn(() => obj))()` returns the empty `this` — stub constructors with a plain `function(){ return mock }`. Clean up peers/lobbies in `afterEach`. E2E: each flow must pass `cairn run --cold-start` green and be stamped; `testUser` is `${run.token}` (unique per flow, ≤20 chars for the username limit).

**Commands**: `bun run test:unit | test:integration | test:components`; `npx vitest run <file>` for one; `bun run test:e2e` (cairn builds + boots a prod-preview server itself); `bun run typecheck`, `bun run lint` (oxlint), `bun run format` (oxfmt), `bun run knip`.

### bot-ai

Expert in NPC bot behavior and lane assignment.

**Owns**: `server/game/ai/`

**Key files**:

- `BotManager.ts` — `registerBots`, `getBotPlayerIds`, `getBotLane`, `isBot`, `cleanupGame`
- `BotAI.ts` — `decideBotAction` (lane-based movement, attack priority, ability usage)

**Conventions**: Bot IDs use `bot_` prefix. Bots are assigned lanes on game creation. `decideBotAction` runs per-bot before draining the player action queue each tick. Bots never receive WebSocket messages.

### map-systems

Expert in zone topology, creep spawning, towers, and wards.

**Owns**: `server/game/map/`, `shared/constants/zones.ts`, `shared/types/map.ts`

**Key files**:

- `shared/constants/zones.ts` — 32 zones with `adjacentTo` arrays (fountain → base → T3 → T2 → T1 → river)
- `topology.ts` — `areAdjacent`, `findPath` (BFS), `getDistance`
- `spawner.ts` — `spawnCreepWaves` (every 8 ticks: 3 melee + 1 ranged, siege every 5th wave), `spawnRunes` (every 60 ticks), `spawnNeutralCreeps` (every 60 ticks)
- `zones.ts` — `initializeZoneStates`, `initializeTowers`, `placeWard`, `removeExpiredWards`

**Map layout**: 3 lanes (top/mid/bot), 4 jungle zones, 2 rune spots, Roshan pit, 2 bases + fountains. Each lane has 3 tower tiers per side with a river crossing in between.
