# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Termina is a text-based multiplayer MOBA (5v5) played through a terminal-inspired browser UI. Frontend is Nuxt 3 + Vue 3 + Pinia. Backend is Nitro with Effect-TS for the game engine. The game runs on 4-second ticks with deterministic action resolution.

## Commands

```bash
# Dev server (do NOT use bun --bun flag — it breaks WebSocket proxy chain)
bun run dev

# Tests
bun run test              # Watch mode (all projects)
bun run test:unit         # Unit tests only (node env)
bun run test:integration  # Integration tests (node env)
bun run test:e2e          # E2E tests (happy-dom env)
npx vitest run tests/unit/engine/GameLoop.test.ts  # Single test file

# Lint & format
bun run lint
bun run format

# Database (requires PostgreSQL via docker-compose)
docker compose up -d      # Start PostgreSQL + Redis
bun run db:generate       # Generate Drizzle migrations
bun run db:migrate        # Apply migrations
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
- **Type imports**: ESLint enforces `import type { ... }` for type-only imports
- **Testing**: Vitest with `vi.fn()` mocks; tests use `describe/it` blocks; mock WebSocket/PeerRegistry in unit tests
- **CSS theming**: Custom properties in `:root` (terminal.css), Tailwind extends them (e.g., `text-radiant`, `bg-bg-primary`, `text-dire`)

## Important Gotchas

- **Never use `bun --bun nuxt dev`** — Bun's native HTTP breaks the WebSocket proxy chain in dev mode
- **Font imports** go in `app/assets/css/terminal.css` via `@import`, not in `nuxt.config.ts` `css` array (prevents SSR 404s)
- **`<ClientOnly>`** is needed around auth-conditional UI in layouts (Nuxt 4 compat loads layouts async, causing hydration mismatches)
- **`processTick` validates actions twice** — once in GameLoop (line 88) and once inside `resolveActions`. The GameLoop validation catches rejections for player feedback; the ActionResolver validation is a safety net
- **Bot IDs** start with `bot_` prefix — checked via `isBot()` from BotManager
- **Lobby cleanup** happens in `game-server.ts` after game creation, not in lobby.ts — prevents race condition where poll returns 'searching' between lobby end and game start
