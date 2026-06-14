# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Termina is a text-based multiplayer MOBA (5v5) played through a terminal-inspired browser UI. Frontend is Nuxt 4 + Vue 3 + Pinia 3 (Tailwind 4). Backend is Nitro with Effect-TS for the game engine, PostgreSQL via Drizzle, and Redis. The game runs on 4-second ticks with deterministic action resolution. Tooling is oxc-based: **oxlint** (lint), **oxfmt** (format), **knip** (dead-code), with lefthook git hooks. Runtime is Bun.

## Commands

```bash
# Dev server (do NOT use bun --bun flag — it breaks WebSocket proxy chain)
bun run dev

# Tests
bun run test              # EVERYTHING: all Vitest projects (run mode) + the e2e suite
bun run test:watch        # Vitest watch mode (fast iteration)
bun run test:unit         # Unit tests (node env)
bun run test:integration  # Integration tests (node env) — needs Postgres (docker compose up -d)
bun run test:e2e          # Cairntrace browser e2e — scripts/e2e.mjs auto-starts a dev
                          #   server with TERMINA_TEST_HOOKS=1 if none is on :3000, else reuses it
bun run test:api          # API tests (hitspec, requires running server)
npx vitest run tests/unit/engine/GameLoop.test.ts  # Single test file
cairn run tests/e2e/flows/objectives_seeded.yml --config tests/e2e/cairntrace.config.yml --cold-start  # Single e2e flow

# CI: .github/workflows/ci.yml runs checks (lint/typecheck/knip/tests/build) + e2e
# (installs cairn from github, uploads run artifacts) on push/PR, with PG+Redis services.

# Lint, format, typecheck, dead-code (oxc tooling — NOT eslint/prettier)
bun run lint              # oxlint
bun run format            # oxfmt --write   (format:check for CI)
bun run typecheck         # nuxt typecheck  (vue-tsc over the split Nuxt 4 tsconfigs)
bun run knip              # unused files/deps/exports

# Database (requires PostgreSQL via docker-compose).
# NOTE: the DB is `drizzle-kit push`-managed — schema.ts is the source of truth.
# The file-migration history is vestigial/broken; do NOT rely on db:generate/migrate.
# Apply a schema change with `drizzle-kit push` (or direct SQL for index/dedupe).
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

## Key Conventions

- **Immutable state updates**: Game state uses spread operators, never mutate in place
- **Effect.gen for async pipelines**: Server-side async uses Effect generators, not raw promises
- **Discriminated unions**: Protocol messages use `{ type: '...' }` discriminator
- **Unused vars**: Prefix with `_` (e.g., `_details`)
- **Type imports**: oxlint enforces `import type { ... }` (`typescript/consistent-type-imports`)
- **Imports**: server code uses the `~~/server/...` root alias, not `../../` (`~~` → repo root, `~`/`@` → `app/`); resolves in Nitro, vitest, and tsc
- **Testing**: Vitest 4 for unit tests — projects live in `test.projects` in `vitest.config.ts` (`bun run test:unit|components|integration`), `vi.fn()` mocks, `describe/it`; hitspec for API tests (`.http` in `collections/`); Cairntrace BDD for E2E browser tests (`tests/e2e/`, YAML flows that seed an exact game via the `server/api/test/*` dev hooks instead of playing a match — see the **End-to-end** section of `README.md`)
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
- **vue-router stays at 4** (Nuxt 4 ships/uses it); a harmless `vue-router/volar/sfc-route-blocks` warning from vue-tsc is non-fatal
