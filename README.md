# TERMINA - Strategic Turn-Based MOBA

A text-based multiplayer online battle arena (MOBA) where strategy matters more than reflexes. Built with modern web technologies for a chess-like MOBA experience.

## 🎮 Features

### Core Gameplay
- **5v5 Strategic Battles** - Turn-based combat with 4-second ticks
- **18 Unique Heroes** - Programming-themed champions with distinct abilities
- **40+ Items** - Complete item system with passives and actives
- **Draft Phase** - Alternating hero picks (snake draft)
- **Talent Trees** - Binary choices at levels 10/15/20/25 for build diversity

### Strategic Mechanics
- **Deny System** - Kill allied creeps below 50% HP to deny gold/XP
- **Buyback** - Instant respawn for gold (100 + 25×level)
- **Surrender Voting** - 60% majority required after 15 minutes
- **Vision Game** - Ward placement + missing enemy detection
- **Cooldown Tracking** - See enemy ability timers

### Anti-Cheat & Fair Play
- **Leaver Detection** - AFK detection after 2 minutes
- **Low-Priority Queue** - Penalty system for repeat leavers
- **Rate Limiting** - 5 actions/second, 10 burst
- **Vision Validation** - Prevent map hacks
- **Stat Validation** - Detect impossible states

### Infrastructure
- **State Persistence** - Redis snapshots every 4 minutes
- **Auto-Recovery** - Restore games after server restart
- **Effect-TS** - Type-safe functional programming
- **WebSocket** - Real-time communication
- **PostgreSQL** - Match history and stats

---

## 🏗️ Architecture

```
termina/
├── app/                    # Vue 3 Frontend
│   ├── components/         # UI components
│   ├── composables/        # Vue composables
│   ├── pages/              # Nuxt pages
│   └── stores/             # Pinia state
├── server/
│   ├── api/                # REST endpoints
│   ├── game/               # Core game engine
│   │   ├── engine/         # Game loop, state management
│   │   ├── heroes/         # Hero abilities, talent trees
│   │   ├── items/          # Item system
│   │   ├── matchmaking/    # Queue, lobby, draft
│   │   └── ai/             # Bot AI
│   ├── services/           # Infrastructure services
│   │   ├── RedisService.ts
│   │   ├── DatabaseService.ts
│   │   ├── WebSocketService.ts
│   │   ├── GameStatePersistence.ts
│   │   └── LeaverSystem.ts
│   └── routes/             # WebSocket handler
├── shared/                 # Shared types & constants (+ shared/types/*.d.ts augmentations)
└── tests/                  # Vitest (unit/integration/component) + Cairntrace (E2E)
```

### Technology Stack
- **Frontend**: Nuxt 4, Vue 3, Pinia 3, Tailwind 4
- **Backend**: Nitro (Nuxt server), Effect-TS
- **Database**: PostgreSQL + Drizzle ORM
- **Cache**: Redis (pub/sub, persistence)
- **Real-time**: WebSocket (crossws)
- **Runtime**: Bun
- **Tooling**: oxlint (lint) · oxfmt (format) · knip (dead-code) · lefthook (git hooks)
- **Testing**: Vitest (unit/integration/component) · Cairntrace (browser E2E, seeded via dev hooks)

---

## 🚀 Getting Started

### Prerequisites
- Bun (latest)
- PostgreSQL 14+
- Redis 6+

### Installation

```bash
# Install dependencies
bun install

# Copy environment variables
cp .env.example .env

# Start databases (Docker)
docker-compose up -d

# Run migrations
bun run db:migrate

# Start development server
bun run dev
```

### Environment Variables

```env
# Session
SESSION_PASSWORD=your-secret-password

# OAuth (optional)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

# Redis
REDIS_URL=redis://localhost:6379

# Database
DATABASE_URL=postgresql://termina:termina@localhost:5432/termina
```

---

## 🎯 How to Play

### Game Commands

**Movement:**
```
move <zone>          # Move to adjacent zone
```

**Combat:**
```
attack <target>      # Attack hero/creep/tower
cast <q|w|e|r>       # Use ability
deny <creep_index>   # Deny allied creep (<50% HP)
```

**Items:**
```
buy <item>           # Purchase item (in shop)
sell <slot>          # Sell item (slot 0-5)
use <item>           # Use item active
```

**Strategy:**
```
buyback              # Instant respawn (when dead)
surrender yes|no     # Vote to surrender
missing <enemy>      # Ping missing enemy
select_talent <tier> <id>  # Choose talent at level 10/15/20/25
```

**Communication:**
```
chat all <message>   # Send to all players
chat team <message>  # Send to team only
```

### Game Flow

1. **Queue** - Join ranked_5v5, quick_3v3, or 1v1
2. **Draft** - Alternating hero picks (snake draft)
3. **Laning** - Last-hit creeps, deny, harass
4. **Mid Game** - Team fights, objectives, towers
5. **Late Game** - Roshan, mega creeps, base race

---

## 📊 Game Systems

### Talent Trees

Each hero has 8 talents (2 choices × 4 tiers):

**Level 10** - Stat bonuses (+15 Attack or +200 HP)
**Level 15** - Ability enhancements (+damage or -cooldown)
**Level 20** - Major power spikes (+30% damage or +25% resist)
**Level 25** - Ultimate upgrades (AOE+, double cast, etc.)

Example (Echo):
```
Level 10: +15 Attack Damage OR +200 HP
Level 15: Echo Stun +0.5s OR -2s Echo Location CD
Level 20: +30% Echo Damage OR +15% Magic Resist
Level 25: Ultimate AOE +50% OR Double Echo (25% chance)
```

### Deny Mechanics

- **When**: Allied creep below 50% HP
- **Reward**: 50% gold + 50% XP
- **Prevention**: Enemy gets nothing
- **Command**: `deny <creep_index>`

### Buyback System

- **Cost**: 100 + (25 × level) + (10 × deaths)
- **Cooldown**: 90 ticks (6 minutes)
- **Effect**: Instant respawn at fountain, full HP/MP
- **Command**: `buyback`

### Leaver Penalties

- **Detection**: 30 ticks (2 minutes) without actions
- **Penalty**: +10 leaver score per incident
- **Threshold**: 30 score = low-priority queue
- **Clear**: Complete 3 low-priority games
- **Decay**: -1 point per day

---

## 🧪 Testing

### Unit / integration / component (Vitest 4)

```bash
bun run test:unit          # unit (node env)
bun run test:integration   # integration (node env)
bun run test:components    # component (happy-dom)
bun run typecheck          # nuxt typecheck
```

~2,800 Vitest tests across the engine, all 18 heroes, items, matchmaking,
services, stores, and composables. Projects live in `test.projects` in
`vitest.config.ts`; single file: `npx vitest run tests/unit/engine/GameLoop.test.ts`.

### End-to-end (Cairntrace + dev seed hooks)

Browser E2E uses [Cairntrace](https://github.com/abdul-hamid-achik/cairntrace)
YAML flows paired with **dev-only seed hooks** so a spec lands in an exact game
or draft state instead of playing a flaky bot match. **29 flows** cover every
behaviour of the former Playwright suite (`cairn run tests/e2e/flows
--cold-start` → 29/29, ~7m). Cairntrace does NOT start the app — bring up a dev
server with the hooks on first, then point `cairn` at it:

```bash
# 1. dev server with the test hooks enabled
TERMINA_TEST_HOOKS=1 bun run dev

# 2. whole suite (= `bun run test:e2e`; add --junit --stamp-if-green for CI = test:e2e:ci)
cairn run tests/e2e/flows --config tests/e2e/cairntrace.config.yml --cold-start

# one flow · lint+stamp a contract · heal selectors after a UI rename
cairn run        tests/e2e/flows/game_screen_renders.yml --config tests/e2e/cairntrace.config.yml --cold-start
cairn spec verify tests/e2e/flows/game_screen_renders.yml --config tests/e2e/cairntrace.config.yml --stamp
cairn spec heal   tests/e2e/flows/game_screen_renders.yml
```

`tests/e2e/` holds `flows/` (one behaviour per file, self-documenting headers),
reusable `actions/` (`login`, `new_game`), `cairntrace.config.yml`, and a
gitignored `runs/` artifact root. Two flows are `partial`:
`game_websocket_connection` (connect-on-mount only — the `join_game` frame needs
a WS-frame verifier cairntrace lacks) and `lobby_queue` (the live queue→match
transition isn't seeded; the draft→game path is covered by
`lobby_matchmaking_to_game`).

#### Dev seed hooks (`server/api/test/*`)

The point: **stop having to play the game to test it.** These build a *real*
`GameState` through the same `createGame`/`startGameLoop` path the lobby uses —
only **matchmaking** is bypassed. Every hook is **double-gated**
(`NODE_ENV !== 'production' && TERMINA_TEST_HOOKS === '1'`): in production every
route 404s and the helpers hard-return.

| Route | Body | Returns | Purpose |
| --- | --- | --- | --- |
| `login-as` | `{ username }` | `{ playerId }` | Mint a session for a dev user (create if missing). Username `\w{3,40}`. |
| `new-game` | `{ scenario?, heroSelf?, seed?, manualTick? }` | `{ gameId, playerId, url }` | Build a real 5v5 (user + 9 bots), apply the scenario, return the `/play` URL. Skips matchmaking. |
| `new-draft` | `{ prepick? }` | `{ lobbyId, playerId, team, url }` | Seed a hero draft frozen at the user's pick turn (`prepick` slots pre-picked by bots). The pick runs the real `pickHero`→`game_ready` pipeline. `prepick:5`=mid-draft, `prepick:9`=final pick→game. Skips the live matchmaker. |
| `advance` | `{ gameId, ticks }` | `{ tick }` | Step a `manualTick` game N ticks immediately (deterministic). |
| `state` (GET) | `?gameId=` | `GameState` | Engine-truth snapshot for `httpJson`/`script` verifiers (cross-check the DOM against engine state). |
| `force-end` | `{ gameId, winner }` | `{ ended }` | End a live game → the post-game screen renders. |

**Scenarios** (`applyScenario` in `server/game/dev/scenarios.ts`, pure
`(state, opts) => GameState` transforms): `fresh`/`laning`, `roshan_dead`,
`core_vulnerable`, `night`, `self_dead` (kills the human → death overlay; seed
with `manualTick: true`). Add more as specs need them. Engine-side seeding lives
in `server/plugins/game-server.ts` (`createDevGame`/`advanceDevGame`),
`server/game/matchmaking/lobby.ts` (`seedDraftLobby`), and `GameLoop.ts`
(`runOneTick`).

**Determinism & isolation:** specs seed state (never play); tick-progression
specs use `manualTick: true` + `advance`; `testUser` is `cairn_${run.token}`
(per-run identity — Termina broadcasts state per user-id, so a shared user would
clobber another spec's seeded game). Flush the test Redis between sessions:
`redis-cli -n 1 FLUSHDB`.

---

## 🔧 Development

### Adding a New Hero

1. Create hero definition in `shared/constants/heroes.ts`
2. Implement abilities in `server/game/heroes/`
3. Add talent tree in `server/game/heroes/talent-trees.ts`
4. Write tests in `tests/unit/heroes/`

### Adding a New Item

1. Add to `server/game/items/registry.ts`
2. Implement active/passive in `server/game/items/effects.ts`
3. Add to shop in `shared/constants/items.ts`
4. Write tests

### Adding a New Game Mode

1. Add mode to `shared/types/game.ts`
2. Implement matchmaking in `server/game/matchmaking/queue.ts`
3. Adjust rules in `server/game/engine/GameLoop.ts`
4. Update frontend in `app/pages/play/`

---

## 📈 Performance

### Current Capabilities
- **Tick Rate**: 4 seconds (250ms planned for future)
- **Players per Game**: 10 (5v5)
- **Concurrent Games**: ~50 per server instance
- **Memory**: ~100MB per active game

### Optimization Roadmap
- [ ] Delta compression for state updates
- [ ] Vision calculation caching
- [ ] Horizontal scaling (sharding)
- [ ] Database read replicas
- [ ] Event batching

---

## 🛡️ Security

### Implemented
- ✅ Authentication required (no bot bypass)
- ✅ Rate limiting (5 actions/sec)
- ✅ Vision validation (no map hacks)
- ✅ Cooldown validation (no CDR hacks)
- ✅ Stat validation (no HP/MP hacks)
- ✅ Input sanitization (XSS prevention)

### Best Practices
- Never trust client input
- Validate all actions server-side
- Use Effect-TS for type safety
- Log all suspicious activity
- Regular security audits

---

## 📝 License

MIT License - See LICENSE file for details

---

## 👥 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run checks: `bun run lint && bun run typecheck && bun run test:unit`
5. Submit a pull request (lefthook runs oxlint + oxfmt + knip on commit, tests on push)

### Code Style
- TypeScript strict mode; type-only imports enforced by oxlint
- Effect-TS for error handling; functional, immutable patterns
- Formatted by oxfmt; cross-dir imports use the `~~/server` / `~~/shared` aliases
- Comprehensive test coverage (Vitest + Cairntrace)

---

## 🎉 Credits

**Created by**: TERMINA Team
**Inspired by**: Dota 2, League of Legends, Chess
**Built with**: Love, Effect-TS, and lots of coffee

---

## 📞 Support

- **Discord**: [Join our server]
- **GitHub**: [Open an issue]
- **Email**: support@termina.game

---

**Version**: 1.0.0  
**Last Updated**: June 2026
