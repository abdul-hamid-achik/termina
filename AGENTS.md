# Termina — Agent & Contributor Guide

> **`CLAUDE.md` and `AGENTS.md` are kept identical.** Claude Code reads `CLAUDE.md`; other agent tools read `AGENTS.md`. Edit one, then copy it to the other (`cp CLAUDE.md AGENTS.md`) so they never drift.

This file provides guidance to Claude Code (claude.ai/code) and any other AI/contributor working in this repository.

## What This Is

Termina is a text-based multiplayer MOBA (5v5) played through a terminal-inspired browser UI. Frontend is Nuxt 4 + Vue 3 + Pinia 3 (Tailwind 4). Backend is Nitro with Effect-TS for the game engine, PostgreSQL via Drizzle, and Redis. The game runs on 4-second ticks with deterministic action resolution. Tooling is oxc-based: **oxlint** (lint), **oxfmt** (format), **knip** (dead-code), with lefthook git hooks. Runtime is Bun.

## WORLD (settled — do not invent lore)

TERMINA is a cable-landing city. Twelve transoceanic trunks come out
of the sea here and stop. Districts: LANDING, ROOKERY, COLDSTORE,
SHALLOWS. The three routes across the ground are SEAWALL, COLDSTORE
and SHALLOWS.

THE BATCH CLOCK IS CANON. The city commits every instruction at once,
four seconds wide, in no order. It was built that way to end a latency
arms race that was killing people over ten metres of ground. The
player-facing word is CYCLE. Internal field is also `cycle` (identifier
sweep complete) — do not reintroduce `tick` as a state field.

Two crews contest the routes. CHAFF came up off the street. AUDIT is
Quorum's corporate response division. Quorum is both a team and the
terrain: the ICE, the wave traffic and the clock are all Quorum's.

Wave units go DOWN, not dead. A last hit is a strip — you take the
payload, not a life. A deny is a burn. Keep the register dry and
procedural. Nobody in a wave is a bystander.

The 18 hero ids never change (echo, daemon, malloc, cron, mutex,
socket, proxy, regex, kernel, lambda, cipher, cache, thread, sentry,
firewall, ping, traceroute, null_ref). They are HANDLES, with a real
person behind each. No id migration, no DB change.

Art direction is PHOSPHOR: monochrome green CRT, scanlines, box
drawing. The product IS a terminal and it should look like one.
Operator portraits are inked, rendered monochrome green.

English only. If a world fact is missing, raise it — do not fill it in.

## Lexicon (single source: shared/constants/world.ts)

Player-facing names live in ONE module so copy cannot drift. TeamId is
'chaff' | 'audit' (FACTION_META: CHAFF/AUDIT). Structures are ICE (T3 is
BLACK ICE). Objectives: THE TENANT (its pit is the Hollow), BACKUP (the
drop), caches (five buff types), CAMTAP/SNIFFER (vision), HARDEN (team ICE
invulnerability), BURN (the last-hit-your-own wave verb), SCRIP (currency).
The Silt holds five camps: STUB/WATCHDOG/WARDEN/ORPHAN/ZOMBIE. Wave
units are asymmetric by crew — chaff fields mule/script/picket, audit
fields guard/sweeper/auditor (WAVE_UNIT_LABELS keyed by team+role). Items
partition into five cyberware classes: STREET / CHROME / HARDWARE / DECK /
WETWARE (naming rule at the top of shared/constants/items.ts). The pickup
verb is `grab` (cache is a hero handle). Engine modules: IceAI.ts,
TenantAI.ts, CacheAI.ts, WaveAI.ts.

## Commands

```bash
# Dev server (do NOT use the bun --bun flag — see Important Gotchas).
# For OAuth + DB (+ Ably) locally, inject the LOCAL secret set:
#   tvault -p termina-local run -- bun run dev   (see Deployment → Secrets)
bun run dev

# Tests
bun run test:all          # LITERALLY EVERYTHING — pure package.json composition, NO scripts/ file:
                          #   test:db (Postgres + isolated termina_test + schema) → all
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
                          #   in vitest.config.ts (lines 79 / branches 70 / funcs 77 / stmts 77)
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

Each cycle (4s) runs this pipeline in `processCycle`:
1. Bot AI decides actions → `submitAction()`
2. Drain action queue (1 action per player per cycle)
3. Validate actions via `validateAction()` — rejected ones return with reason
4. Resolve in phases: instant abilities → movement → attacks/casts → passives/cooldowns → buy/sell
5. WaveAI + IceAI
6. Spawn waves, distribute scrip, handle respawns, fountain healing, deaths, level ups
7. Check win condition
8. Broadcast vision-filtered state to each player via `filterStateForPlayer()`

`processCycle` itself is transport-agnostic (pure `GameState` in, `GameState` + events out) — it is now driven by **Vercel Workflow**, one tick at a time, rather than a long-lived in-process loop. See `server/workflows/gameTick.ts` (the thin, statically-bundled workflow body — `runGame`, sleeps to the next 4s boundary, chains a continuation every 250 ticks) and `gameTickCore.ts` (the heavy step bodies, loaded via dynamic import: reads/writes the `live_games` row in Neon under a CAS guard, drains `pending_actions`, calls `processCycle`, publishes the result to Ably).

### Effect-TS Service Pattern

`DatabaseService` (Drizzle ORM wrapper over Neon/Postgres) is the one surviving Effect Context.Tag + Layer service — resolved once at boot by `server/plugins/game-server.ts`'s minimal `ManagedRuntime` and exposed via `getGameRuntime().dbService`. `RedisService` and `WebSocketService` (DO-era) are gone; nothing in the running system talks to Redis or manages a WebSocket connection registry anymore. The `~50` other server files that use `Effect.gen`/`Effect.runPromise` do so as a thin typed-error wrapper over plain async work, not for DI.

### Realtime Flow (Ably)

The client's `useGameChannel` composable (selected via `useGameTransport()`) subscribes to a per-player Ably channel (`game:{gameId}:p:{playerId}`), authenticated by a short-lived token minted at `POST /api/auth/ably-token` (`server/utils/ablyToken.ts`). Each `gameTickStep` publishes that tick's vision-filtered `cycle_state` to Ably over REST (`server/utils/ablyRest.ts`) — there is no persistent server-side connection registry (no `PeerRegistry`/`WebSocketService`) because nothing needs to track "who's connected to what": Ably owns delivery. Outbound player actions go the other way, over plain HTTP: `POST /api/game/action` writes to the `pending_actions` table, drained by the next tick.

### State Flow (Client)

Ably `cycle_state` messages → `useGameChannel` → `routeServerMessage` (`app/utils/gameMessageRouter.ts`) → Pinia stores:
- `game.ts` store: cycle state, player state, scoreboard, events
- `lobby.ts` store: queue status (Neon-backed quick-match only — the 5v5 draft/pick UI it also owns is currently unreachable; see `app/pages/lobby.vue`)
- `auth.ts` store: session via `nuxt-auth-utils`

`gameStore.playerId` = OAuth session user ID (e.g., `github_7379966`). This same ID is used as the key in `GameState.players` on the server.

### Map Topology

Zones are defined in `shared/constants/zones.ts` with `adjacentTo` arrays. Movement validation checks `areAdjacent()` — players can only move one zone per cycle. Fountain is only adjacent to base.

### Vision System

`VisionCalculator.filterStateForPlayer()` computes visible zones per player (own zone + adjacent, camtaps, ICE, allies). Enemies outside vision are returned as `FoggedPlayer` (minimal info only).

## Deployment

Production is **all-Vercel** (the DigitalOcean split was demolished after cutover — no `infra/` Pulumi program, no Dockerfile, no DOCR image, no `deploy.yml` anymore):

- **Vercel** hosts everything: the Nuxt frontend (SSR + `/api/*` routes, same-origin — no cross-origin proxy needed) at `www.terminamoba.com`, backed by **Neon Postgres** (via the Vercel Marketplace integration). `NUXT_PUBLIC_API_URL` exists only for a hypothetical future origin split and is empty in prod.
- **Vercel Workflow DevKit** (`workflow/nuxt` module) drives each game's 4s tick — see the Game Loop Pipeline section above. `POST /api/game/start-workflow` (internal, `WORKFLOW_START_KEY`-gated) or the tutorial/practice/matchmaking paths (`server/game/liveGame.ts`'s `startLiveGame`) create the `live_games` row and kick off the first tick.
- **Ably** is the realtime transport (Realtime for client subscriptions, REST for server-side publish) — see the Realtime Flow section above. Requires `ABLY_API_KEY`.
- **Matchmaking** is Neon-backed (`server/game/matchmaking/queueNeon.ts`, `queue_entries` table) — event-driven match formation (no background sweep; a Vercel serverless function can't keep one warm). The Redis sorted-set queue and its WS-pushed lobby/draft flow (`lobby.ts`) are gone; a quick-match goes straight from "searching" to a running game with bots autofilled and heroes round-robin-assigned, no pick screen. A Neon-backed draft is an open follow-up, not yet built.
- **Auth tokens** (password reset, email verification) are Neon-backed (`auth_tokens` table, `server/utils/authTokens.ts`) — single-use, `DELETE ... RETURNING` on redemption. No Redis TTL keys anymore.
- **Secrets**: local dev secrets live in the tvault project `termina-local` (run: `tvault -p termina-local run -- bun run dev`; localhost-callback GitHub OAuth app + docker Postgres only — no local Redis either). Prod secrets are Vercel environment variables, managed via the tvault project `termina` for reference/backup. Always pass `-p` to tvault — bare `tvault run` uses whatever project is currently active.
- **Auth invariant**: `NUXT_SESSION_PASSWORD` must stay stable across deploys (rotating it invalidates every live session cookie).
- Readiness (`GET /api/ready`) checks the Postgres schema contract only — there is no separate "runtime starting" window to gate on in a serverless deploy.

## Key Conventions

- **Immutable state updates**: Game state uses spread operators, never mutate in place
- **Effect.gen for async pipelines**: Server-side async uses Effect generators, not raw promises
- **Discriminated unions**: Protocol messages use `{ type: '...' }` discriminator
- **Unused vars**: Prefix with `_` (e.g., `_details`)
- **Type imports**: oxlint enforces `import type { ... }` (`typescript/consistent-type-imports`)
- **Imports**: server code uses the `~~/server/...` root alias, not `../../` (`~~` → repo root, `~`/`@` → `app/`); resolves in Nitro, vitest, and tsc
- **No `scripts/` folder / no orchestration scripts** (owner preference): there is NO `scripts/` directory — do NOT create one or add `*.mjs|*.ts` glue for builds/tests/servers. Compose behavior from `package.json` scripts (chained with `&&`, env inline) + config + a small idiomatic dev dep. E.g. "boot a server → wait → test → tear down" is `start-server-and-test 'bun run serve:test' <url> 'bun run …'`, NOT a custom runner — this is exactly why the old `scripts/e2e.mjs` → cairntrace `webServer` and why there is no `test-all.mjs`. The one standalone manual *tool* (a bot-match balance simulator) lives in the code as `server/game/dev/simulate-game.ts` — run it via `bun run sim [matches] [maxTicks]` (or directly with `bun server/game/dev/simulate-game.ts …`). With `matches>1` it prints a BALANCE SUMMARY (side win-rate + 2σ significance, length spread, per-hero win-rate with a `*` for win-rates beyond small-sample noise) via the unit-tested `server/game/dev/simStats.ts`. NOT in a `scripts/` folder.
- **Testing**: Vitest 4 for unit tests — projects live in `test.projects` in `vitest.config.ts` (`bun run test:unit|components|integration`), `vi.fn()` mocks, `describe/it`; hitspec for API tests (`.http` in `collections/`); Cairntrace BDD for E2E browser tests (`tests/e2e/`, YAML flows that drive the real app — register/log in through the UI, navigate, assert; NO test hooks. Game/engine truth lives in `bun run test:gameplay`. See the **End-to-end** section of `README.md`)
- **CSS theming**: Custom properties in `:root` (terminal.css), Tailwind 4 utilities extend them (e.g., `text-chaff`, `bg-bg-primary`, `text-audit`). Tailwind 4 is wired via `@tailwindcss/vite` + an `@config` directive in terminal.css that keeps the v3-style `tailwind.config.ts` theme

## Important Gotchas

- **Never use `bun --bun nuxt dev`** — Bun's native HTTP has broken Nuxt dev-server behavior before (originally documented against the now-deleted WS proxy chain; untested since realtime moved to Ably, so the caution stays defensive)
- **Font imports** go in `app/assets/css/terminal.css` via `@import`, not in `nuxt.config.ts` `css` array (prevents SSR 404s)
- **`<ClientOnly>`** is needed around auth-conditional UI in layouts (Nuxt 4 loads layouts async, causing hydration mismatches)
- **`processCycle` validates actions once in production** — GameLoop validates up front (catching rejections for player feedback); `resolveActions` only re-validates in dev/test as a divergence assertion ("GameLoop should have filtered this — a divergence is a bug"). It used to validate twice; the redundant production pass was removed
- **Bot IDs** start with `bot_` prefix — checked via `isBot()` from BotManager
- **knip config is `knip.config.ts`, NOT `knip.json`** — knip resolves `knip.json` first, so adding one shadows the tuned config and explodes findings. Unused exports/types are advisory `warn`; unused files/deps fail the gate
- **oxfmt formats everything by default** — its `.oxfmtrc.json` `ignorePatterns` MUST exclude `tests/e2e/**` (stamped cairntrace YAML — reformatting breaks the contractHash), `server/db/migrations/**`, and `**/*.{md,yml,yaml}`
- **Type augmentations go in `shared/types/*.d.ts`** (e.g. the `#auth-utils` `User` augmentation) — Nuxt 4's split tsconfigs don't load `server/types/*.d.ts` as global augmentations, but `shared/**/*.d.ts` is in both the app and server include
- **`players` and `hero_stats` both have `games_played` + `wins`** — bare column refs in a join/upsert are ambiguous in Postgres; qualify them (e.g. `hero_stats.games_played` in `ON CONFLICT DO UPDATE`)
- **vue-router stays aligned with Nuxt's requirement** — Nuxt 4.4.8 requires `vue-router@5` for the `vue-router/volar/sfc-route-blocks` plugin; pinning v4 reintroduces `ERR_PACKAGE_PATH_NOT_EXPORTED` during `vue-tsc`
- **Histoire is PINNED to `1.0.0-beta.1`** (`histoire` + `@histoire/plugin-vue`) — the only line that supports Vite 7 (what Nuxt 4 ships); the default "latest stable" 0.17.x does NOT. Do not switch to a `^` range. It renders components in a standalone (non-Nuxt) Vite runtime, so `histoire.setup.ts` installs Pinia + stubs `<NuxtLink>`/global `navigateTo`, and `histoire.config.ts` adds `@vitejs/plugin-vue` + `@tailwindcss/vite` + the `~`/`~~`/`@` aliases and imports `terminal.css`. Story files are `app/**/*.story.vue`; shared mock factories live in `app/stories/fixtures.ts`; store-coupled stories seed via the store's refs/`updateFromCycle`. Histoire's builtin `tailwind-tokens` plugin logs a HARMLESS non-fatal `[Plugin:builtin:tailwind-tokens]` error (it calls Tailwind v3's `resolveConfig`, gone in v4) — ignore it; the build still exits 0. `app/**/*.story.vue` + `histoire.config.ts`/`histoire.setup.ts` are knip entries; `.histoire/` is gitignored
- **Coverage thresholds are ENFORCED** by `bun run test:coverage` (v8) at lines 79 / branches 70 / functions 77 / statements 77 in `vitest.config.ts` — set just under the achieved actuals (lines ~79 / branches ~70.5 / funcs ~77.4 / stmts ~77.6); raise as coverage climbs, never above what's earned

## Agent Roles

Specialized roles for working on the Termina codebase — ownership + key files per area. Pick the role that matches the change.

### game-engine

Expert in the server-side game loop and combat systems.

**Owns**: `server/game/engine/`, `shared/constants/balance.ts`

**Key files**:

- `GameLoop.ts` — `processCycle` (the pure per-tick pipeline, driven by Vercel Workflow — see the Game Loop Pipeline section above), `submitAction`/`submitReplayAction` (the in-process action queue a tick drains)
- `ActionResolver.ts` — `validateAction`, `resolveActions` (phase-ordered: instant → move → attack → passive → buy)
- `StateManager.ts` — `createPlayerState`, `createInitialGameState`, in-memory Effect service
- `VisionCalculator.ts` — `filterStateForPlayer`, fog-of-war per team
- `DamageCalculator.ts` — kinetic/code/black damage formulas (plate/ice mitigation)
- R4 combat lexicon: damage types kinetic/code/black; mitigation plate/ice; pools INTEG/BW; immunity AIRGAP; access state BREACH (code halved into closed targets; hard control fails until breached)
- `CombatResolver.ts` — `resolvePhysicalHit` unified NPC→hero damage path (wraps `_base.dealDamage`); `computeBladeMailReflect` single reflect formula
- `ScripDistributor.ts` — passive scrip, kill bounties, last-hit rewards
- `WaveAI.ts`, `IceAI.ts` — NPC behavior each cycle
- `NeutralAI.ts` — Silt dweller spawning, attacking heroes
- `TenantAI.ts` — the Tenant's attacks, death handling, backup drops
- `CacheAI.ts` — cache spawning, buffs, pickup

**Mechanics**:

- Harden/Fortification — team-wide ICE invulnerability (5 cycle duration, 300 cycle cooldown). Command: `harden`. Key files: ActionResolver.ts (harden phase), GameLoop.ts (expiration)
- Day/Night Cycle — time-based vision system (Day: 300 ticks, Night: 240 ticks, night vision penalty: -1 zone). Key files: GameLoop.ts (time progression), VisionCalculator.ts (penalty)
- TP Scroll Channeling — teleport with interrupt (2 cycle channel, cancels on damage/movement). Key files: \_base.ts (channeling completion), ActionResolver.ts (cancellation)
- Sniffers — true sight mechanic, reveals invisible units (75sc cost, 240 cycle duration). Key files: VisionCalculator.ts (true sight), zones.ts (ward types)
- Backup Resurrection — instant revive at death location with full HP/MP. Key files: GameLoop.ts (backup check in handleDeaths)

**Conventions**: Immutable state updates via spread. All engine functions return `Effect.Effect<...>`. Game state is `Record<string, PlayerState>` keyed by playerId. One action per player per cycle.

### hero-designer

Expert in hero definitions, abilities, and game balance.

**Owns**: `server/game/heroes/`, `shared/constants/heroes.ts`, `shared/types/hero.ts`

**Key files**:

- `shared/constants/heroes.ts` — `HEROES` registry, `HERO_IDS` list
- `shared/constants/postures.ts` — `POSTURE_META` / `POSTURE_ORDER` (the player-facing axis)
- `shared/constants/cast.ts` — `CAST` (the 18 operators as people: realName, origin, bio, handleRationale, kitReading)
- `server/game/heroes/_base.ts` — `levelUpHero`, `processDoTs`, `tickAllBuffs`
- `server/game/heroes/<name>.ts` — individual hero definitions (18 heroes)

**Hero data model**: POSTURE (BREACH/HOLD/ROAM/HARDLINE) is the player-facing
label everywhere a human reads (pick screen, /heroes, /lore). `role` survives
ONLY because BotManager's lane priority and itemBuilds' ROLE_BUILD_ORDERS
consume it — never surface it as the primary label. Operator portraits live in
`public/portraits/` (36 webp + PROVENANCE.txt), generated ONCE from the vault
(~/notes/projects/termina/Rewrite 2026-07/portrait-gen.py) — never from a repo
script (the no-scripts/ rule stands). Hero ids never change (B1a); typed forms
are normalised (`nullref`/`null-ref` resolve to `null_ref`).

**Balance ranges**: INTEG 400–800, BW 150–400, attack 30–70, plate 2–6 (tanks up to 8), ice 12–25. Each hero has `attackType: 'kinetic' | 'code'` (basic attack damage type). Abilities have cooldownTicks, bwCost (BW cost per ability rank), effects array with damage/heal/stun/silence/root/slow/shield/dot/buff/debuff/teleport/reveal/taunt/fear/execute types.

**Mechanics constants** (balance.ts): HARDEN_DURATION_CYCLES = 5, HARDEN_COOLDOWN_CYCLES = 300, DAY_DURATION_CYCLES = 300, NIGHT_DURATION_CYCLES = 240, NIGHT_VISION_PENALTY = 1, SNIFFER_DURATION_CYCLES = 30.

### frontend

Expert in the Vue 3 game UI, stores, and Ably realtime integration.

**Owns**: `app/`

**Key files**:

- `composables/useGameChannel.ts` — Ably Realtime lifecycle (subscribe to `game:{gameId}:p:{playerId}`, token auth, reconnect), routes inbound messages, sends outbound actions over `POST /api/game/action`. Selected via `composables/useGameTransport.ts` (a thin permanent wrapper — the DO-era `useGameSocket` + the flag it picked between are gone)
- `composables/useCommands.ts` — command parsing (`move`, `attack`, `cast`, `buy`, etc.) and autocomplete
- `composables/useServerUrl.ts` — `useApiOrigin`/`rewriteApiRequest`, a same-origin/cross-origin API fetch transform kept for a hypothetical future origin split (empty/no-op today); paired with `app/plugins/api-origin.client.ts`
- `stores/game.ts` — `updateFromCycle`, player state, scoreboard, events
- `stores/lobby.ts` — queue flow; only `idle`/`searching` are reachable on the live (Neon quick-match) path today — `found`/`picking`/`banning`/`starting` (the 5v5 draft/ban UI, `HeroPicker.vue`) have no current trigger, kept for a future Neon-backed draft
- `stores/auth.ts` — session via `nuxt-auth-utils`; OAuth via `navigateTo('/api/auth/<provider>', { external: true })`
- `components/game/GameScreen.vue` — terminal shell: STREAM + TRACE + status lines + ActionRow + prompt
- `components/game/TraceRail.vue` — route as hop depth, contacts, both terminals (replaces the 2D board)
- `components/game/Stream.vue` — combat log / stream (full-height center column)
- `components/game/StatusLines.vue` — always-on hop / net / cycle clock lines
- `components/game/ActionRow.vue` — phone-first move/strip/burn + ability strip (hidden on fine pointer)
- `pages/lobby.vue` — quick-match queue (HTTP polling via `useQueuePolling`) + party/guild panels + practice launcher

**Conventions**: Terminal-themed UI. CSS vars in `assets/css/terminal.css`. Tailwind 4 (wired via `@tailwindcss/vite` + an `@config` directive that keeps the v3-style `tailwind.config.ts` theme) utility classes using custom colors (`text-chaff`, `text-audit`, `text-self`, `bg-bg-primary`). `<ClientOnly>` required around auth-conditional rendering.

### matchmaking

Expert in the Neon-backed queue and live-game start-up.

**Owns**: `server/game/matchmaking/`, `server/api/queue/`, `server/game/liveGame.ts`

**Key files**:

- `queueNeon.ts` — `joinQueue`, `leaveQueue`, `tryFormMatchNeon` (Postgres `queue_entries` table + `pg_advisory_xact_lock`, no background sweep — event-driven: forms a match inline on join, and opportunistically again on a status poll)
- `matchStart.ts` — `assignQuickMatchRoster` (round-robin heroes, alternate teams by MMR-sorted index — no pick screen), `startFormedMatch`
- `party.ts` — in-memory co-op party (create/join/leave, leader-only start); `server/api/party/start-coop.post.ts` starts the live game directly (party on chaff, bots fill the rest — no draft)
- `elo.ts` — `calculateMmrChange`, `teamAverageMmr`
- `server/game/liveGame.ts` — `startLiveGame` (seeds the `live_games` row + kicks off the first Workflow tick), shared by the tutorial/practice, quick-match, and party co-op paths
- `server/api/queue/join-neon.post.ts`, `leave-neon.post.ts`, `status-neon.get.ts` — the HTTP endpoints `useQueuePolling` (client) actually calls

**Flow**: Join → `tryFormMatchNeon` forms a roster (bot-backfilled after a 10s wait) → `startLiveGame` seeds `live_games` and starts the Workflow tick → the client's poll (`GET /api/queue/status-neon`) sees `{status: 'found', gameId}` and navigates to `/play`. No lobby, no hero pick/ban screen — heroes are round-robin assigned. The DO-era Redis sorted-set queue (`queue.ts`) and its WS-pushed snake-draft lobby (`lobby.ts`, ban phase 2-per-side R/D/R/D) are gone; a Neon-backed draft is an open follow-up (`queueNeon.ts`'s doc comment), not yet built.

### services

Expert in the DatabaseService layer, Ably realtime plumbing, and the Vercel Workflow tick.

**Owns**: `server/services/`, `server/plugins/game-server.ts`, `server/workflows/`, `server/utils/ablyRest.ts`, `server/utils/ablyToken.ts`

**Key files**:

- `DatabaseService.ts` — Drizzle ORM queries (players, matches, hero stats), the one surviving `Context.Tag` + `Layer.succeed` Effect service. DB is `drizzle-kit push`-managed — `schema.ts` is the source of truth; apply schema changes with `bun run db:push`. The file-migration history is vestigial, so there are no `db:generate`/`db:migrate` recipes. `players` and `hero_stats` both have `games_played`/`wins`, so qualify those columns in joins/upserts
- `LeaverSystem.ts` — AFK detection (`detectAFKPlayers`, `shouldConvertAFK`) — pure GameState logic `GameLoop.ts`'s `processCycle` calls directly. The Redis-backed leaver-penalty ledger (score/low-priority queue) was already dead before the cutover and is gone; the in-memory "deliberate client input" ledger (`markClientInput`/`msSinceClientInput`) has no live producer since the DO-era WS route that used to stamp it is gone — every AFK check degrades to the "disconnected" branch until an Ably-presence signal is wired back in
- `game-server.ts` — minimal boot plugin: `registerAllHeroes()` + resolves `DatabaseServiceLive` once into `getGameRuntime().dbService` (read by most API routes as their "is the DB layer up" gate). Everything Redis/fiber/reaper/spectator/finalize-intent that used to live here died with the DO-era in-process game server
- `server/workflows/gameTick.ts` — the THIN, statically-bundled workflow body (`runGame`, `shouldChainAt`) — Workflow DevKit forbids Node-module imports anywhere in a workflow module's static import graph, so this file must stay clean
- `server/workflows/gameTickCore.ts` — the heavy step bodies (loaded via dynamic `import()` inside `gameTick.ts`'s steps): `runOneTick` (CAS-guarded tick against `live_games`), `finalizeGame`, `rehydrateRegistries`
- `ablyToken.ts` / `ablyRest.ts` — per-player token auth (`mintAblyToken`) and server→client publish (`ablyPublishBatch`)

**Pattern**: `DatabaseService` uses `Context.Tag` + `Layer.succeed` for DI, resolved once at boot. Everything else uses `Effect.gen`/`Effect.runPromise` as a thin typed-error wrapper, not for DI — there is no long-lived runtime to attach a service layer to on a per-tick Workflow step. Bot filtering via `isBot()` prevents publishing Ably messages to bot players.

### tester

Expert in writing and maintaining Vitest (unit/integration/component) and Cairntrace (browser E2E) tests.

**Owns**: `tests/`

**Key files**:

- `tests/unit/engine/` — GameLoop, ActionResolver, StateManager, VisionCalculator, DamageCalculator
- `tests/unit/heroes/` — per-hero stat and ability validation
- `tests/unit/services/` — LeaverSystem (AFK detection)
- `tests/unit/workflows/` — `gameTick`/`gameTickCore` (CAS idempotency, chain boundary, action drain)
- `tests/unit/matchmaking/` — elo, matchStart, party
- `tests/unit/stores/` — game store, lobby store
- `tests/unit/composables/` — useGameChannel, useGameTransport, useCommands, useAudio, useServerUrl
- `tests/e2e/` — **Cairntrace** YAML flows that drive the REAL app (register/log in through the UI, navigate, assert); NO test seed hooks. `flows/`, reusable `actions/login.yml`, `cairntrace.config.yml`. Game/engine truth lives in `tests/gameplay/` (`bun run test:gameplay`). See the **End-to-end** section of the root `README.md`.

**Patterns**: Vitest 4 — projects are in `test.projects` in `vitest.config.ts`. `vi.fn()` mocks; `vi.mock()` for modules (BotManager, DatabaseService); `vi.useFakeTimers()`; `Effect.runSync` for Effect code. NOTE vitest 4: `new (vi.fn(() => obj))()` returns the empty `this` — stub constructors with a plain `function(){ return mock }`. Clean up in-memory state (parties, bot registries) in `afterEach`. E2E: each flow must pass `cairn run --cold-start` green and be stamped; `testUser` is `${run.token}` (unique per flow, ≤20 chars for the username limit).

**Commands**: `bun run test:unit | test:integration | test:components`; `npx vitest run <file>` for one; `bun run test:e2e` (cairn builds + boots a prod-preview server itself); `bun run typecheck`, `bun run lint` (oxlint), `bun run format` (oxfmt), `bun run knip`.

### bot-ai

Expert in NPC bot behavior and lane assignment.

**Owns**: `server/game/ai/`

**Key files**:

- `BotManager.ts` — `registerBots`, `getBotPlayerIds`, `getBotLane`, `isBot`, `cleanupGame`
- `BotAI.ts` — `decideBotAction` (lane-based movement, attack priority, ability usage)

**Conventions**: Bot IDs use `bot_` prefix. Bots are assigned lanes on game creation. `decideBotAction` runs per-bot before draining the player action queue each cycle. Bots never receive realtime (Ably) messages.

### map-systems

Expert in zone topology, wave spawning, ICE, and vision (camtaps/sniffers).

**Owns**: `server/game/map/`, `shared/constants/zones.ts`, `shared/types/map.ts`

**Key files**:

- `shared/constants/zones.ts` — 32 zones with `adjacentTo` arrays (fountain → base → T3 → T2 → T1 → river)
- `topology.ts` — `areAdjacent`, `findPath` (BFS), `getDistance`
- `spawner.ts` — `spawnCreepWaves` (every 8 ticks: 3 melee + 1 ranged, siege every 5th wave), `spawnRunes` (every 60 ticks), `spawnNeutralCreeps` (every 60 ticks)
- `zones.ts` — `initializeZoneStates`, `initializeTowers`, `placeWard`, `removeExpiredWards`

**Map layout**: 3 routes (top/mid/bot), 4 Silt zones, 2 cache spots, the Hollow, 2 bases + fountains. Each route has 3 ICE tiers per side with a crossing in between.
