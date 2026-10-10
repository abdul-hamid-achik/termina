# Termina — Agent & Contributor Guide

> **`AGENTS.md` is the single source of truth.** `CLAUDE.md` is a one-line `@AGENTS.md` import so Claude Code loads this same file. Edit only `AGENTS.md`; never put content in `CLAUDE.md`.

This file provides guidance to any AI agent or contributor working in this repository.

Private working notes (plans, playability findings, handoffs, ADRs) live in the owner's Obsidian vault at `~/notes/projects/termina/` — never in the repo, and never linked from public docs.

## What This Is

Termina is a text-based multiplayer MOBA (5v5) played through a terminal-inspired browser UI. Frontend is Nuxt 4 + Vue 3 + Pinia 3 (Tailwind 4). Backend is Nitro with Effect-TS for the game engine, Neon PostgreSQL via Drizzle, Vercel Workflow for the per-game clock and Ably for realtime (no Redis, no WebSockets). The game runs on 4-second cycles with deterministic action resolution. Tooling is oxc-based: **oxlint** (lint), **oxfmt** (format), **knip** (dead-code), with lefthook git hooks. Runtime is Bun.

## How the game plays (code-verified 2026-10-10)

- **Win**: destroy the enemy **Terminal** (`TERMINAL_HP` 6000, `server/game/engine/TerminalSystem.ts`). It is firewalled until ANY one of that team's three T3 ICE (BLACK ICE) falls; ICE in a route must fall T1 → T2 → T3 (`canAttackIce`). Surrender: from `SURRENDER_MIN_CYCLE` (225) with 60% of the team's humans; tutorial has no minimum.
- **Map**: 32 zones (`shared/constants/zones.ts`). Three routes (SEAWALL / COLDSTORE / SHALLOWS), each `T3-T2-T1-cross-T1-T2-T3` between `rookery-terminal` (chaff base, shop) and `landing-terminal` (audit base, shop); each base has an `-anchor` (fountain). Four Silt camp zones, two cache spots on the river, and the `hollow` (Tenant pit). Base-to-base is 8 hops. Subset maps in `shared/constants/maps.ts`: `two_lane` (22, quick 3v3), `one_lane` (11, tutorial/1v1).
- **Orders**: per cycle a player gets ONE main order plus separate item-use, talent, buyback and surrender slots. A `move` to any reachable zone is a standing auto-path (one hop per cycle, BFS); an `attack` on a hero/ICE/Tenant is a standing order. `attack ice:<zone>` / `attack terminal` typed from outside the zone walks there and swings on arrival (the order is held; a taunt never replaces it; item uses keep the walk except the four movement items). Structure refusal texts live in `shared/utils/structureRules.ts` and are shared by client pre-flight and server. ICE gates attacks, never movement.
- **BREACH (the core combat rule)**: code damage into a CLOSED (not breached) hero is halved and hard control (stun/silence/root/taunt/fear) fails. `breach <hero>` costs 50 BW, opens the target for 5 cycles, 10-cycle cooldown; it resolves before movement, so a target that walks away that cycle is still opened. AIRGAP grants immunity. Damage: kinetic vs plate and code vs ice both `dmg×100/(100+armor)`; black is raw.
- **Economy**: start 600 scrip, +4/cycle passive. STRIP a wave unit at ≤35% of its spawn INTEG (40 scrip, 75 for a breach unit; same-cycle claimants split). BURN your own unit at ≤50% (you keep half). Kill 200 + 50/streak × comeback; assist 100 split; ICE 500 split; Tenant 600. Shop only in your own base/anchor; 6 slots; sell 50%. Buyback `100 + 25×level + 10×deaths`, 90-cycle cooldown.
- **NPCs**: waves every 8 cycles per route per crew — 3 line + 1 sweep, a breach unit every 5th wave, +35% per 50 cycles (cap 4×). ICE hits 120/cycle. Silt dwellers and caches every 60 cycles. The Tenant (5000 INTEG) drops BACKUP: an instant in-place revive buff.
- **Progression**: Q/W/E ranks at levels 1/3/5/7, R at 6/12/18, max level 25. Talent tiers are NAMED 10/15/20/25 but unlock at levels 3/6/9/12 (`TALENT_UNLOCK_LEVEL`). Respawn `3 + (level-1)` cycles.

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
The Silt (four camp zones) spawns five dweller types: STUB/WATCHDOG/WARDEN/ORPHAN/ZOMBIE. Wave
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

Each cycle (4s) runs this pipeline in `processCycle` (`GameLoop.ts`; the numbered comments in the code are the source of truth):
0. Bot AI decides actions → `submitAction()`
1. Drain the in-process queue; deliberate orders cancel a standing walk/attack; standing orders (auto-path `moveTarget`, `attackTarget`) are re-issued as synthesized actions
1.5. Special actions: buyback, surrender vote, talent pick
2. Validate via `validateAction()` — rejections carry a reason (the third identical one escalates with a help pointer)
3. `resolveActions` phases: anti-cheat filter → taunt override → item actives → **breach** (co-location checked at cycle-start positions, so walking away does not dodge it) → instant stuns/silences → movement → burns → attacks → targeted casts → passives → shop → post-shop (breach self-flush, harden, pickups, strip awards, ICE kills, wards)
3.4–3.7. Tutorial advance/graduation, ICE-kill tracking, in-combat flags, Socket traps, harden expiry
4–5.7. NPC AI (waves, Silt, ICE, Tenant), Terminal vulnerability recompute
6–10.6. Spawns, cache/ward expiry, passive scrip, respawns, fountain, DoTs, buff tick
11–13. Deaths + kill credit, hero passives, level-ups, win check
13.5. Day/night; every 60 cycles AFK takeover
14. Merge events onto state (they ride inside `cycle_state`)

Randomness is deterministic: one `mulberry32(mix(rngSeed, cycle))` per cycle; a replay is `(roster, rngSeed, actionLog)` re-run through `processCycle`.

`processCycle` itself is transport-agnostic (pure `GameState` in, `GameState` + events out) — it is driven by **Vercel Workflow**, one tick at a time. `server/workflows/gameTick.ts` is the thin, statically-bundled workflow body (`runGame` claims a `runEpoch` stored in the state jsonb so a duplicate run exits as `stale`, sleeps to its 4s grid, chains a continuation every 250 ticks). `gameTickCore.ts` holds the heavy step bodies, loaded via dynamic import: `runOneTick` reads the `live_games` row, rehydrates the per-instance registries (heroes, bots — including AFK-converted `aiControlled` humans), reads `pending_actions`, calls `processCycle`, CAS-writes `WHERE cycle = loaded` (and epoch matches), deletes the consumed `pending_actions` only after the CAS wins, then publishes the fog-filtered result per player to Ably. Broadcast happens here, not in `processCycle`.

### Effect-TS Service Pattern

`DatabaseService` (Drizzle ORM wrapper over Neon/Postgres) is the one surviving Effect Context.Tag + Layer service — resolved once at boot by `server/plugins/game-server.ts`'s minimal `ManagedRuntime` and exposed via `getGameRuntime().dbService`. `RedisService` and `WebSocketService` (DO-era) are gone; nothing in the running system talks to Redis or manages a WebSocket connection registry anymore. The `~50` other server files that use `Effect.gen`/`Effect.runPromise` do so as a thin typed-error wrapper over plain async work, not for DI.

### Realtime Flow (Ably)

The client's `useGameChannel` composable (selected via `useGameTransport()`) subscribes to a per-player Ably channel (`game:{gameId}:p:{playerId}`), authenticated by a 1-hour subscribe-only TokenRequest minted at `POST /api/auth/ably-token` (`mintAblyTokenRequest` in `server/utils/ablyToken.ts`; Ably owns reconnect, the composable only mirrors connection state). Each `gameTickStep` publishes that tick's vision-filtered `cycle_state` to Ably over REST (`server/utils/ablyRest.ts`) — there is no persistent server-side connection registry (no `PeerRegistry`/`WebSocketService`) because nothing needs to track "who's connected to what": Ably owns delivery. Outbound player actions go the other way, over plain HTTP: `POST /api/game/action` stamps the order with the `forCycle` it targets and writes to `pending_actions` only if that cycle is still open (one conditional insert); late/future orders and orders for an ended game return `accepted:false`.

### State Flow (Client)

Ably `cycle_state` messages → `useGameChannel` → `routeServerMessage` (`app/utils/gameMessageRouter.ts`) → Pinia stores:
- `game.ts` store: cycle state, player state, scoreboard, events
- `lobby.ts` store: queue status via the `-neon` queue routes (the 5v5 draft/pick UI it also owns is unreachable; `app/pages/lobby.vue` drives the queue through `useQueuePolling`)
- `auth.ts` store: session via `nuxt-auth-utils`

`gameStore.playerId` = OAuth session user ID (e.g., `github_7379966`). This same ID is used as the key in `GameState.players` on the server.

### Map Topology

Zones are defined in `shared/constants/zones.ts` with symmetric `adjacentTo` arrays. A `move` to ANY zone of the game's map with a path is valid (`findPath` in `shared/pathfinding.ts`, BFS gated on the game's live zone set); the hero walks one hop per cycle until arrival. The client mirrors the BFS for previews. Anchor (fountain) is only adjacent to its base.

### Vision System

`VisionCalculator.filterStateForPlayer()` computes visible zones per player: own zone + adjacent, allies, own ICE, home zones, camtap/sniffer wards, Ping's tracepath, Tracer Dust, and `revealed` buffs. Night drops one neighbouring zone (enemy side first). Enemies outside vision are returned as `FoggedPlayer` (hero/level/KDA only). ICE, Terminals, caches, the Tenant and BACKUP are always visible.

## Deployment

Production is **all-Vercel** (the DigitalOcean split was demolished after cutover — no `infra/` Pulumi program, no Dockerfile, no DOCR image, no `deploy.yml` anymore; a leftover `termina-ws` App Platform app, its registry repo and `NUXT_PUBLIC_WS_URL` were deleted on 2026-10-10):

- **Vercel** hosts everything: the Nuxt frontend (SSR + `/api/*` routes, same-origin — no cross-origin proxy needed) at `www.terminamoba.com`, backed by **Neon Postgres** (via the Vercel Marketplace integration). `NUXT_PUBLIC_API_URL` exists only for a hypothetical future origin split and is empty in prod.
- **Git auto-build is `preview` only** (`vercel.json`). A push to `main` does not create a deployment. Ship production by promoting the Preview artifact, then merging for history:

  ```bash
  vercel promote <preview-deployment-url> --scope the-lacanians --yes
  git switch main && git merge --ff-only preview && git push origin main
  ```

  Promoting a **preview** deployment triggers a NEW production build with the **Production** environment variables (Vercel docs: "Promote preview deployment to production"), so Preview's branch-scoped DB/session vars never reach production. Verify after every promote: `GET /api/ready` on production must show `deployment.env: "production"`, `dbMatch: true`, and an `appDb` fingerprint DIFFERENT from the preview deployment's (`main` vs `preview` Neon branch). Changelog / `AGENTS.md` / `CLAUDE.md` / `.github` commits are skipped by `ignoreCommand`.
- **Vercel Workflow DevKit** (`workflow/nuxt` module) drives each game's 4s tick — see the Game Loop Pipeline section above. `POST /api/game/start-workflow` (internal: public in the session middleware, gated only by the `x-workflow-start-key` header compared timing-safe) or the tutorial/practice/matchmaking paths (`server/game/liveGame.ts`'s `startLiveGame`) create the `live_games` row and kick off the first tick.
- **Ably** is the realtime transport (Realtime for client subscriptions, REST for server-side publish) — see the Realtime Flow section above. Requires `ABLY_API_KEY`.
- **Matchmaking** is Neon-backed (`server/game/matchmaking/queueNeon.ts`, `queue_entries` table) — event-driven match formation (no background sweep; a Vercel serverless function can't keep one warm). A quick-match goes straight from "searching" to a running game with bots autofilled and heroes round-robin-assigned, no pick screen. If the game fails to start, the formed players are requeued with their original `joinedAt`. A Neon-backed draft is an open follow-up, not yet built. Parties are Neon-backed (`parties` + `party_members` tables, `party.ts` async under `pg_advisory_xact_lock(hashtext('parties'))`, max 5, oldest member promoted on leave, parties older than 6h swept on create). Queue and co-op bots get `difficultyForMmr(avg human MMR)`; practice bots stay `easy`.
- **Auth tokens** (password reset, email verification) are Neon-backed (`auth_tokens` table, `server/utils/authTokens.ts`) — single-use, `DELETE ... RETURNING` on redemption. No Redis TTL keys anymore.
- **Databases**: Neon project `termina` has two branches. `main` is production. `preview` is a schema-only branch (no player data, compute 0.25–1 CU, autosuspend) used by Preview deployments of the `preview` git branch through **branch-scoped** Vercel env vars (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NUXT_DATABASE_URL`, `NUXT_SESSION_PASSWORD` with gitBranch=`preview`), which override the Neon integration's shared Production+Preview vars. Schema changes: dry-run first (`pg_dump --schema-only` → local copy → `drizzle-kit push --verbose`), then push to `preview` and to `main` before promoting. Fetch connection strings on demand with `neonctl connection-string <branch> …` for the `termina` project (project/org ids live in the owner's private notes, not here) into a 0600 temp file or straight into a command's env — never print, paste or commit one. Test fixtures build connection strings at runtime with `tests/helpers/pgUrl.ts` (reserved `.test` hosts, generated passwords); never commit a connection-string literal that carries credentials.
- **Secrets** — no credential or connection string is ever written in the repo (code, tests, CI YAML, docs). Everything is read from the environment, and missing values fail loudly with a tvault hint. Four tvault projects, same key names across environments; always pass `-p`:
  - `termina-local` — local dev + tests: `TERMINA_POSTGRES_PASSWORD` (docker-compose), `DATABASE_URL`/`NUXT_DATABASE_URL` (dev DB), `TEST_DATABASE_URL` (termina_test), `TEST_SESSION_PASSWORD` + `TEST_ABLY_API_KEY` (serve:test / e2e), `NUXT_SESSION_PASSWORD`, `ABLY_API_KEY`, `WORKFLOW_START_KEY`, localhost OAuth app. Run everything through it: `tvault -p termina-local run -- docker compose up -d`, `… run -- bun run dev`, `… run -- bun run test:db`, `… run -- bun run test:integration`, `… run -- bun run test:all`.
  - `termina-preview` — the Preview deployment's branch-scoped Vercel values (preview Neon branch URLs, preview session secret).
  - `termina` — production reference/backup of the Vercel Production env (Vercel is the source of truth at runtime).
  - `termina-ci` — mirror of the GitHub Actions repository secrets: `CI_POSTGRES_PASSWORD` (throwaway CI container), `TEST_DATABASE_URL`, `TEST_SESSION_PASSWORD`, `TEST_ABLY_API_KEY`. `ci.yml` reads them as `${{ secrets.* }}`; rotate by `tvault -p termina-ci set … --stdin` then `gh secret set … < file`.
  Test fixtures that need a connection string build it at runtime with `tests/helpers/pgUrl.ts`.
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
- **Bot IDs** start with `bot_` prefix — checked via `isBot()` from BotManager. But an AFK-converted human keeps their id and is a bot only by registry membership: use `isGameBot`/`getBotPlayerIds` for "who does the AI drive", and remember the registry is per-instance and rebuilt every tick by `rehydrateRegistries` (from `roster` + `aiControlled` players in state)
- **Every per-process Map is per-instance on serverless** (rate limiter buckets, anti-cheat history, bot registries, rejection escalation). Anything that must survive across ticks belongs in the `live_games.state` jsonb or a table
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
- `ActionResolver.ts` — `validateAction`, `resolveActions` (phase order in the Game Loop Pipeline section above). Every consumed-but-ineffective order must push a one-line reason to `rejected` — never a bare `continue`
- `StateManager.ts` — `createPlayerState`, `createInitialGameState`, in-memory Effect service
- `VisionCalculator.ts` — `filterStateForPlayer`, fog-of-war per team
- `DamageCalculator.ts` — kinetic/code/black damage formulas (plate/ice mitigation)
- R4 combat lexicon: damage types kinetic/code/black; mitigation plate/ice; pools INTEG/BW; immunity AIRGAP; access state BREACH (code halved into closed targets; hard control fails until breached)
- `CombatResolver.ts` — `resolveKineticHit` unified NPC→hero damage path (wraps `_base.dealDamage`); `computeSpitePlateReflect` single reflect formula
- `TerminalSystem.ts` — the win condition: `resolveTerminalAttack` (derives vulnerability from live ICE state, so a T3 and the Terminal can fall in the same cycle), `checkTerminalWin`
- `SurrenderSystem.ts`, `BuybackSystem.ts`, `TrapSystem.ts` (Socket's Listen traps), `replayArtifact.ts` (replay row + `reconstructReplay`)
- `ScripDistributor.ts` — passive scrip, kill bounties, last-hit rewards
- `WaveAI.ts`, `IceAI.ts` — NPC behavior each cycle. Wave-vs-wave damage is simultaneous (a unit downed earlier in the same pass still lands its blow) — the batch clock is canon
- `NeutralAI.ts` — Silt dweller spawning, attacking heroes
- `TenantAI.ts` — the Tenant's attacks, death handling, backup drops
- `CacheAI.ts` — cache spawning, buffs, pickup

**Mechanics**:

- Harden/Fortification — team-wide ICE invulnerability (5 cycle duration, 300 cycle cooldown). Command: `harden`. Key files: ActionResolver.ts (harden phase), GameLoop.ts (expiration)
- Day/Night Cycle — time-based vision system (Day: 300 cycles, Night: 240 cycles, night vision penalty: -1 zone). Key files: GameLoop.ts (time progression), VisionCalculator.ts (penalty)
- TP Scroll Channeling — teleport with interrupt (2 cycle channel, cancels on damage/movement). Key files: \_base.ts (channeling completion), ActionResolver.ts (cancellation)
- Sniffers — true sight mechanic, reveals invisible units (75sc cost, `SNIFFER_DURATION_CYCLES` = 30). Camtaps last 45 cycles; 3 wards per team. Key files: VisionCalculator.ts (true sight), map/zones.ts (`placeWard`)
- Backup Resurrection — instant revive at death location with full INTEG/BW. Key files: GameLoop.ts (backup check in handleDeaths)
- Item active cooldowns — always the buff id `item_cd_${itemId}` via `itemCooldownId()` in `server/game/items/shop.ts` (legacy Dota-era ids once made 13 actives cooldown-free)

**Conventions**: Immutable state updates via spread. All engine functions return `Effect.Effect<...>`. Game state is `Record<string, PlayerState>` keyed by playerId. One MAIN action per player per cycle, plus separate item/talent/buyback/surrender slots (`GameLoop.ts` slot table).

### hero-designer

Expert in hero definitions, abilities, and game balance.

**Owns**: `server/game/heroes/`, `shared/constants/heroes.ts`, `shared/types/hero.ts`

**Key files**:

- `shared/constants/heroes.ts` — `HEROES` registry, `HERO_IDS` list
- `shared/constants/postures.ts` — `POSTURE_META` / `POSTURE_ORDER` (the player-facing axis)
- `shared/constants/cast.ts` — `CAST` (the 18 operators as people: realName, origin, bio, handleRationale, kitReading)
- `server/game/heroes/_base.ts` — `levelUpHero`, `processDoTs`, `cycleAllBuffs`, `resolveAbility` (cast gates), `applyBuff` (hard-control BREACH gate), `dealDamage` (mitigation order)
- `server/game/heroes/<name>.ts` — individual hero definitions (18 heroes)

**Hero data model**: POSTURE (BREACH/HOLD/ROAM/HARDLINE) is the player-facing
label everywhere a human reads (pick screen, /heroes, /lore). `role` survives
ONLY because BotManager's lane priority and itemBuilds' ROLE_BUILD_ORDERS
consume it — never surface it as the primary label. Operator portraits live in
`public/portraits/` (36 webp + PROVENANCE.txt), generated ONCE from the vault
(~/notes/projects/termina/Rewrite 2026-07/portrait-gen.py) — never from a repo
script (the no-scripts/ rule stands). Hero ids never change (B1a); typed forms
are normalised (`nullref`/`null-ref` resolve to `null_ref`).

**Balance ranges** (actuals): INTEG 440–750, BW 250–420, attack 38–65, plate 1–8 (mages 1, tanks 7–8), ice 12–25. Each hero has `attackType: 'kinetic' | 'code'` (basic attack damage type; 8 kinetic, 10 code). Abilities have `cooldownCycles`, `bwCost` with optional per-rank `bwCostByLevel`, effects array with damage/heal/stun/silence/root/slow/shield/dot/buff/debuff/teleport/reveal/taunt/fear/execute types.

**Text must match code**: an ability description promises exactly what the resolver does (team checks included — ally-only abilities reject enemies, and the client `validateCommand`/`CommandInput`/`situationalActions` mirrors move with them). Hard control on a CLOSED target is reported honestly in the event, not as applied. Control durations follow the engine convention: `cyclesRemaining: 2` gates exactly one of the target's actions. Talent tiers are named 10/15/20/25 and unlock at levels 3/6/9/12; talent cooldown reductions are in cycles.

**Mechanics constants** (balance.ts): HARDEN_DURATION_CYCLES = 5, HARDEN_COOLDOWN_CYCLES = 300, DAY_DURATION_CYCLES = 300, NIGHT_DURATION_CYCLES = 240, NIGHT_VISION_PENALTY = 1, SNIFFER_DURATION_CYCLES = 30.

### frontend

Expert in the Vue 3 game UI, stores, and Ably realtime integration.

**Owns**: `app/`

**Key files**:

- `composables/useGameChannel.ts` — Ably Realtime lifecycle (subscribe to `game:{gameId}:p:{playerId}`, token auth, reconnect), routes inbound messages, sends outbound actions over `POST /api/game/action`. Selected via `composables/useGameTransport.ts` (a thin permanent wrapper — the DO-era `useGameSocket` + the flag it picked between are gone)
- `composables/useCommands.ts` — command parsing (`move`, `attack`, `cast`, `buy`, etc.) and autocomplete
- `composables/useServerUrl.ts` — `useApiOrigin`/`rewriteApiRequest`, a same-origin/cross-origin API fetch transform kept for a hypothetical future origin split (empty/no-op today); paired with `app/plugins/api-origin.client.ts`
- `stores/game.ts` — `updateFromCycle`, player state, scoreboard, events
- `stores/lobby.ts` — queue/draft state; its HTTP helpers point at the `-neon` routes, but `pages/lobby.vue` drives the live queue through `useQueuePolling` directly, so the store's `found`/`picking`/`banning` states (the 5v5 draft/ban UI, `HeroPicker.vue`) have no current trigger — kept for a future Neon-backed draft
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
- `party.ts` — Neon-backed co-op party (create/join/leave, leader-only start); `server/api/party/start-coop.post.ts` starts the live game directly (party on chaff, bots fill the rest — no draft)
- `elo.ts` — `calculateMmrChange`, `teamAverageMmr`
- `server/game/liveGame.ts` — `startLiveGame` (seeds the `live_games` row + kicks off the first Workflow tick), shared by the tutorial/practice, quick-match, and party co-op paths
- `server/api/queue/join-neon.post.ts`, `leave-neon.post.ts`, `status-neon.get.ts` — the HTTP endpoints `useQueuePolling` (client) actually calls

**Flow**: Join → `tryFormMatchNeon` forms a roster (bot-backfilled after a 10s wait, checked on the next join/poll; MMR-window stragglers are backfilled too) → `startLiveGame` seeds `live_games` and starts the Workflow tick → the client's poll (`GET /api/queue/status-neon`) sees `{status: 'found', gameId}` and navigates to `/play`. No lobby, no hero pick/ban screen — heroes are round-robin assigned. The DO-era Redis sorted-set queue (`queue.ts`) and its WS-pushed snake-draft lobby (`lobby.ts`, ban phase 2-per-side R/D/R/D) are gone; a Neon-backed draft is an open follow-up (`queueNeon.ts`'s doc comment), not yet built.

### services

Expert in the DatabaseService layer, Ably realtime plumbing, and the Vercel Workflow tick.

**Owns**: `server/services/`, `server/plugins/game-server.ts`, `server/workflows/`, `server/utils/ablyRest.ts`, `server/utils/ablyToken.ts`

**Key files**:

- `DatabaseService.ts` — Drizzle ORM queries (players, matches, hero stats), the one surviving `Context.Tag` + `Layer.succeed` Effect service. DB is `drizzle-kit push`-managed — `schema.ts` is the source of truth; apply schema changes with `bun run db:push`. The file-migration history is vestigial, so there are no `db:generate`/`db:migrate` recipes. `players` and `hero_stats` both have `games_played`/`wins`, so qualify those columns in joins/upserts
- `LeaverSystem.ts` — AFK detection (`detectAFKPlayers`, `shouldConvertAFK`), pure GameState logic called by `processCycle` every 60 cycles. Connection state comes from **Ably presence**: the client enters presence on its own `game:{gameId}:p:{playerId}` channel (token grants subscribe+presence there only); at an AFK-check cycle the tick does ONE batch REST presence lookup for humans idle 30+ cycles and stamps confirmed-absent ids into `state.presenceOffline` before `processCycle` (the engine never calls the network). Rules: offline + 30 idle cycles → bot takeover; connected/unknown → only with a human teammate and 60+ idle cycles. Issuing a standing order counts as activity; chat/pings do not. Takeover is permanent (no reclaim). If Ably is unreachable or unconfigured everyone counts as connected.
- `game-server.ts` — minimal boot plugin: `registerAllHeroes()` + resolves `DatabaseServiceLive` once into `getGameRuntime().dbService` (read by most API routes as their "is the DB layer up" gate). Everything Redis/fiber/reaper/spectator/finalize-intent that used to live here died with the DO-era in-process game server
- `server/workflows/gameTick.ts` — the THIN, statically-bundled workflow body (`runGame`, `shouldChainAt`) — Workflow DevKit forbids Node-module imports anywhere in a workflow module's static import graph, so this file must stay clean
- `server/workflows/gameTickCore.ts` — the heavy step bodies (loaded via dynamic `import()` inside `gameTick.ts`'s steps): `claimRun` (stamps `state.runEpoch`), `runOneTick` (CAS + epoch-guarded tick against `live_games`; consumed `pending_actions` deleted only after the CAS wins), `finalizeGame` (records the match; practice games record nothing except `markTutorialCompleted` on a real graduation; throws on a failed record so Workflow retries), `rehydrateRegistries`. No new columns for tick bookkeeping — use the state jsonb (deploys never run `db:push`)
- `ablyToken.ts` / `ablyRest.ts` — per-player token auth (`mintAblyTokenRequest`) and server→client publish (`ablyPublishBatch`)

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

- `BotManager.ts` — `registerBots` (also re-registers `aiControlled` humans, lane from `laneForZone`), `getBotPlayerIds`, `isGameBot`, `convertToBot`, `getBotLane`, `isBot`, `cleanupGame`, `BOT_DIFFICULTY_CONFIGS`
- `BotAI.ts` — `decideBotAction`: dead → buyback; shop/sell in base; retreat tiers; calm-cycle objectives (harden, talent, ward, defend ICE, Tenant, BACKUP); fights (combat items, combos, abilities, burn, lowest-INTEG target); otherwise Terminal, shopping trip, wave, ICE, rotate, Silt, advance with lane support

**Conventions**: Bot IDs use `bot_` prefix. Bots are assigned lanes on game creation (max 2 per lane per team). `decideBotAction` runs per-bot before draining the player action queue each cycle. Bots never receive realtime (Ably) messages. Queue/co-op bots get `difficultyForMmr(average human MMR)` (<900 easy, <1400 medium, <2000 hard, else unfair); practice/tutorial bots are `easy` and pinned to COLDSTORE. `lastHitAccuracy`/`reactionDelayTicks` are intentionally unwired (wiring lastHitAccuracy broke bot forward progress).

### map-systems

Expert in zone topology, wave spawning, ICE, and vision (camtaps/sniffers).

**Owns**: `server/game/map/`, `shared/constants/zones.ts`, `shared/types/map.ts`

**Key files**:

- `shared/constants/zones.ts` — 32 zones with symmetric `adjacentTo` arrays (anchor → base → T3 → T2 → T1 → cross); `isShopZoneFor`
- `shared/constants/maps.ts` — `default_5v5`, `two_lane`, `one_lane`; `mapIdForMode`; `shared/constants/lanes.ts` — `LANE_ROUTES`
- `shared/pathfinding.ts` — `findPath` (BFS, used by server and client); `topology.ts` re-exports it with `areAdjacent`, `getDistance`
- `spawner.ts` — `spawnWaveUnits` (every 8 cycles, per route per crew: 3 line + 1 sweep, a breach unit every 5th wave, spawned at T3), `spawnCaches` (every 60 cycles at `cache-seawall`/`cache-shallows`, one of 5 buffs), Tenant `initializeTenant`/`respawnTenant`. Silt dwellers spawn in `server/game/engine/NeutralAI.ts` (`spawnSiltDwellers`, every 60 cycles, 4 camp zones, max 4 live per camp)
- `zones.ts` — `initializeZoneStates`, `initializeIce`, `placeWard`, `removeExpiredWards`, `canAttackIce` (tier order)

**Map layout**: 3 routes (SEAWALL/COLDSTORE/SHALLOWS), 4 Silt zones, 2 cache spots, the Hollow, 2 bases + anchors. Each route has 3 ICE tiers per side with a crossing in between. 18 ICE total.
