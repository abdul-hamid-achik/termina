# AGENTS.md

This file describes specialized agent roles for working on the Termina codebase with Claude Code teams.

## game-engine

Expert in the server-side game loop and combat systems.

**Owns**: `server/game/engine/`, `shared/constants/balance.ts`

**Key files**:
- `GameLoop.ts` — tick pipeline, `processTick`, `submitAction`, `buildGameLoop`
- `ActionResolver.ts` — `validateAction`, `resolveActions` (phase-ordered: instant → move → attack → passive → buy)
- `StateManager.ts` — `createPlayerState`, `createInitialGameState`, in-memory Effect service
- `VisionCalculator.ts` — `filterStateForPlayer`, fog-of-war per team
- `DamageCalculator.ts` — physical/magical/pure damage formulas
- `GoldDistributor.ts` — passive gold, kill bounties, last-hit rewards
- `CreepAI.ts`, `TowerAI.ts` — NPC behavior each tick

**Conventions**: Immutable state updates via spread. All engine functions return `Effect.Effect<...>`. Game state is `Record<string, PlayerState>` keyed by playerId. One action per player per tick.

## hero-designer

Expert in hero definitions, abilities, and game balance.

**Owns**: `server/game/heroes/`, `shared/constants/heroes.ts`, `shared/types/hero.ts`

**Key files**:
- `shared/constants/heroes.ts` — `HEROES` registry, `HERO_IDS` list
- `server/game/heroes/_base.ts` — `levelUpHero`, `processDoTs`, `tickAllBuffs`
- `server/game/heroes/<name>.ts` — individual hero definitions (10 heroes: echo, sentry, daemon, kernel, regex, socket, proxy, malloc, cipher, firewall)

**Balance ranges**: HP 400–800, MP 150–400, attack 30–70, defense 2–6, magicResist 2–5. Abilities have cooldownTicks, manaCost, effects array with damage/heal/stun/root/slow/shield/dot/buff types.

## frontend

Expert in the Vue 3 game UI, stores, and WebSocket integration.

**Owns**: `app/`

**Key files**:
- `composables/useGameSocket.ts` — WebSocket lifecycle, auto-reconnect, message routing
- `composables/useCommands.ts` — command parsing (`move`, `attack`, `cast`, `buy`, etc.) and autocomplete
- `stores/game.ts` — `updateFromTick`, player state, scoreboard, events
- `stores/lobby.ts` — queue flow (idle → searching → found → picking → starting)
- `components/game/GameScreen.vue` — main game layout, command handling, map/log/hero panels
- `components/game/AsciiMap.vue` — zone grid with player/ally/enemy markers
- `pages/lobby.vue` — matchmaking + hero picker + polling fallback

**Conventions**: Terminal-themed UI. CSS vars in `assets/css/terminal.css`. Tailwind utility classes using custom colors (`text-radiant`, `text-dire`, `text-self`, `bg-bg-primary`). `<ClientOnly>` required around auth-conditional rendering.

## matchmaking

Expert in the queue, lobby, and hero pick systems.

**Owns**: `server/game/matchmaking/`, `server/api/queue/`

**Key files**:
- `queue.ts` — `joinQueue`, `leaveQueue`, `startMatchmakingLoop` (Redis sorted set by MMR)
- `lobby.ts` — `createLobby`, `pickHero`, `confirmPick`, `startReadyCheck` (alternating pick order)
- `server/api/queue/join.post.ts`, `status.get.ts`, `pick.post.ts` — HTTP endpoints

**Flow**: Queue → match found → lobby created → alternating hero picks (15s per pick, auto-random on timeout) → 1.5s delay → 3s countdown → `game_ready` published to Redis → game-server.ts creates game.

## services

Expert in Effect-TS services, WebSocket infrastructure, and the plugin lifecycle.

**Owns**: `server/services/`, `server/plugins/game-server.ts`, `server/routes/ws.ts`

**Key files**:
- `PeerRegistry.ts` — `registerPeer`, `unregisterPeer`, `sendToPeer` (crosswsPeer primary, rawWs fallback)
- `WebSocketService.ts` — per-game connection tracking via Effect Layer
- `RedisService.ts` — pub/sub with `ioredis`, Effect-wrapped
- `DatabaseService.ts` — Drizzle ORM queries (players, matches, hero stats)
- `ws.ts` — WebSocket handler: auth, message dispatch, reconnect with 60s grace window
- `game-server.ts` — `ManagedRuntime` composition, Redis subscription for `game_ready`, game loop callbacks

**Pattern**: Services use `Context.Tag` + `Layer.succeed` for DI. The `ManagedRuntime` provides layers to all game loop fibers. Bot filtering via `isBot()` prevents sending messages to bot players.

## tester

Expert in writing and maintaining Vitest tests.

**Owns**: `tests/`

**Key files**:
- `tests/unit/engine/` — GameLoop, ActionResolver, StateManager, VisionCalculator, DamageCalculator
- `tests/unit/heroes/` — per-hero stat and ability validation
- `tests/unit/services/` — PeerRegistry, WebSocketService, protocol
- `tests/unit/matchmaking/` — queue, lobby
- `tests/unit/stores/` — game store, lobby store
- `tests/unit/composables/` — useGameSocket, useCommands

**Patterns**: `vi.fn()` for mocks. `vi.mock()` for module-level mocking (PeerRegistry, BotManager). `vi.useFakeTimers()` for time-dependent tests. `Effect.runSync` for testing Effect-wrapped code. Property-based validation for hero stat ranges. Always clean up registered peers/lobbies in `afterEach`.

**Commands**: `bun run test:unit` for all, `npx vitest run tests/unit/engine/GameLoop.test.ts` for single file.

## bot-ai

Expert in NPC bot behavior and lane assignment.

**Owns**: `server/game/ai/`

**Key files**:
- `BotManager.ts` — `registerBots`, `getBotPlayerIds`, `getBotLane`, `isBot`, `cleanupGame`
- `BotAI.ts` — `decideBotAction` (lane-based movement, attack priority, ability usage)

**Conventions**: Bot IDs use `bot_` prefix. Bots are assigned lanes on game creation. `decideBotAction` runs per-bot before draining the player action queue each tick. Bots never receive WebSocket messages.

## map-systems

Expert in zone topology, creep spawning, towers, and wards.

**Owns**: `server/game/map/`, `shared/constants/zones.ts`, `shared/types/map.ts`

**Key files**:
- `shared/constants/zones.ts` — 29 zones with `adjacentTo` arrays (fountain → base → T3 → T2 → T1 → river)
- `topology.ts` — `areAdjacent`, `findPath` (BFS), `getDistance`
- `spawner.ts` — `spawnCreepWaves` (every 8 ticks: 3 melee + 1 ranged, siege every 5th wave)
- `zones.ts` — `initializeZoneStates`, `initializeTowers`, `placeWard`, `removeExpiredWards`

**Map layout**: 3 lanes (top/mid/bot), 4 jungle zones, 2 rune spots, Roshan pit, 2 bases + fountains. Each lane has 3 tower tiers per side with a river crossing in between.
