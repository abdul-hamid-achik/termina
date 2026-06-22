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

## hero-designer

Expert in hero definitions, abilities, and game balance.

**Owns**: `server/game/heroes/`, `shared/constants/heroes.ts`, `shared/types/hero.ts`

**Key files**:

- `shared/constants/heroes.ts` — `HEROES` registry, `HERO_IDS` list
- `server/game/heroes/_base.ts` — `levelUpHero`, `processDoTs`, `tickAllBuffs`
- `server/game/heroes/<name>.ts` — individual hero definitions (18 heroes)

**Balance ranges**: HP 400–800, MP 150–400, attack 30–70, defense 2–6 (tanks up to 8), magicResist 12–25. Abilities have cooldownTicks, manaCost, effects array with damage/heal/stun/silence/root/slow/shield/dot/buff/debuff/teleport/reveal/taunt/fear/execute types.

**Mechanics constants** (balance.ts): GLYPH_DURATION_TICKS = 5, GLYPH_COOLDOWN_TICKS = 300, DAY_DURATION_TICKS = 300, NIGHT_DURATION_TICKS = 240, NIGHT_VISION_PENALTY = 1, SENTRY_WARD_DURATION_TICKS = 30.

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

**Conventions**: Terminal-themed UI. CSS vars in `assets/css/terminal.css`. Tailwind 4 (wired via `@tailwindcss/vite` + an `@config` directive that keeps the v3-style `tailwind.config.ts` theme) utility classes using custom colors (`text-radiant`, `text-dire`, `text-self`, `bg-bg-primary`). `<ClientOnly>` required around auth-conditional rendering.

## matchmaking

Expert in the queue, lobby, and hero pick systems.

**Owns**: `server/game/matchmaking/`, `server/api/queue/`

**Key files**:

- `queue.ts` — `joinQueue`, `leaveQueue`, `startMatchmakingLoop` (Redis sorted set by MMR)
- `lobby.ts` — `createLobby`, `pickHero`, `confirmPick`, `startReadyCheck`, `currentPickTurn` (snake pick order). (`seedDraftLobby` is now dead code — it backed the removed `/api/test/new-draft` hook; left in place for a future draft-seed harness.)
- `server/api/queue/join.post.ts`, `status.get.ts`, `pick.post.ts` — HTTP endpoints

**Flow**: Queue → match found → lobby created → snake hero picks (15s per pick, auto-random on timeout) → 1.5s delay → 3s countdown → `game_ready` published to Redis → game-server.ts creates game. (No ban phase.) On lobby reconnect, `ws.ts` re-sends both `lobby_state` AND `pick_turn` so a refreshing/seeded client recovers whose turn it is.

## services

Expert in Effect-TS services, WebSocket infrastructure, and the plugin lifecycle.

**Owns**: `server/services/`, `server/plugins/game-server.ts`, `server/routes/ws.ts`

**Key files**:

- `PeerRegistry.ts` — `registerPeer`, `unregisterPeer`, `sendToPeer` (crosswsPeer primary, rawWs fallback)
- `WebSocketService.ts` — per-game connection tracking via Effect Layer
- `RedisService.ts` — pub/sub with `ioredis`, Effect-wrapped
- `DatabaseService.ts` — Drizzle ORM queries (players, matches, hero stats). DB is `drizzle-kit push`-managed — `schema.ts` is the source of truth; apply schema changes with `bun run db:push`. The file-migration history is vestigial, so there are no `db:generate`/`db:migrate` recipes. `players` and `hero_stats` both have `games_played`/`wins`, so qualify those columns in joins/upserts
- `ws.ts` — WebSocket handler: auth, message dispatch, reconnect with 60s grace window
- `game-server.ts` — `ManagedRuntime` composition, Redis subscription for `game_ready`, game loop callbacks

**Pattern**: Services use `Context.Tag` + `Layer.succeed` for DI. The `ManagedRuntime` provides layers to all game loop fibers. Bot filtering via `isBot()` prevents sending messages to bot players.

## tester

Expert in writing and maintaining Vitest (unit/integration/component) and Cairntrace (browser E2E) tests.

**Owns**: `tests/`

**Key files**:

- `tests/unit/engine/` — GameLoop, ActionResolver, StateManager, VisionCalculator, DamageCalculator
- `tests/unit/heroes/` — per-hero stat and ability validation
- `tests/unit/services/` — PeerRegistry, WebSocketService, protocol
- `tests/unit/matchmaking/` — queue, lobby (+ `seed-draft-lobby`)
- `tests/unit/stores/` — game store, lobby store
- `tests/unit/composables/` — useGameSocket, useCommands, useAudio
- `tests/e2e/` — **Cairntrace** YAML flows that drive the REAL app (register/log in through the UI, navigate, assert); NO test seed hooks. `flows/`, reusable `actions/login.yml`, `cairntrace.config.yml`. Game/engine truth lives in `tests/gameplay/` (`bun run test:gameplay`). See the **End-to-end** section of the root `README.md`.

**Patterns**: Vitest 4 — projects are in `test.projects` in `vitest.config.ts`. `vi.fn()` mocks; `vi.mock()` for modules (PeerRegistry, BotManager); `vi.useFakeTimers()`; `Effect.runSync` for Effect code. NOTE vitest 4: `new (vi.fn(() => obj))()` returns the empty `this` — stub constructors with a plain `function(){ return mock }`. Clean up peers/lobbies in `afterEach`. E2E: each flow must pass `cairn run --cold-start` green and be stamped; `testUser` is `${run.token}` (unique per flow, ≤20 chars for the username limit).

**Commands**: `bun run test:unit | test:integration | test:components`; `npx vitest run <file>` for one; `bun run test:e2e` (cairn builds + boots a prod-preview server itself); `bun run typecheck`, `bun run lint` (oxlint), `bun run format` (oxfmt), `bun run knip`.

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

- `shared/constants/zones.ts` — 32 zones with `adjacentTo` arrays (fountain → base → T3 → T2 → T1 → river)
- `topology.ts` — `areAdjacent`, `findPath` (BFS), `getDistance`
- `spawner.ts` — `spawnCreepWaves` (every 8 ticks: 3 melee + 1 ranged, siege every 5th wave), `spawnRunes` (every 60 ticks), `spawnNeutralCreeps` (every 60 ticks)
- `zones.ts` — `initializeZoneStates`, `initializeTowers`, `placeWard`, `removeExpiredWards`

**Map layout**: 3 lanes (top/mid/bot), 4 jungle zones, 2 rune spots, Roshan pit, 2 bases + fountains. Each lane has 3 tower tiers per side with a river crossing in between.
