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

# Redis (host port 6380 — see docker-compose.yml; off the default 6379)
REDIS_URL=redis://localhost:6380

# Database (host port 5433 — off the default 5432 so it can run alongside
# another project's Postgres; override the host port via TERMINA_POSTGRES_PORT)
DATABASE_URL=postgresql://termina:termina@localhost:5433/termina
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
bun run test               # everything: all Vitest projects + the e2e suite
bun run test:watch         # Vitest watch mode (fast iteration)
bun run test:unit          # unit (node env)
bun run test:integration   # integration (node env) — needs Postgres (docker compose up -d)
bun run test:components    # component (happy-dom)
bun run typecheck          # nuxt typecheck
```

~2,860 Vitest tests across the engine, all 18 heroes, items, matchmaking,
services, stores, and composables. Projects live in `test.projects` in
`vitest.config.ts`; single file: `npx vitest run tests/unit/engine/GameLoop.test.ts`.
The **integration** project includes real-Postgres `DatabaseService` tests
(against a disposable `termina_test` DB), so it needs the docker services up.

### End-to-end (Cairntrace + dev seed hooks)

Browser E2E uses [Cairntrace](https://github.com/abdul-hamid-achik/cairntrace)
YAML flows paired with **dev-only seed hooks** so a spec lands in an exact game
or draft state instead of playing a flaky bot match. The flows cover the **UI**
(auth, nav, lobby, in-game screens); gameplay/engine truth moved to the
in-process `bun run test:gameplay` harness. The easy path is `bun run test:e2e`,
which is just `cairn run tests/e2e/flows --config … --cold-start`: cairn's
`webServer:` config block (cairntrace ≥1.11.0) builds the app and boots a
**production preview server** (`node .output/server`, IPv4, `TERMINA_TEST_HOOKS=1`),
runs the suite, and tears it down — replacing the old `scripts/e2e.mjs`. The prod
preview avoids `nuxt dev`'s Vite-proxy / cold-compile / IPv6 flakiness. To drive
`cairn` by hand against a server you already have on `:3000`, drop `--cold-start`
(it reuses a running server) or point at it:

```bash
# 1. a server with the test hooks (preview = robust; dev = faster to iterate)
TERMINA_TEST_HOOKS=1 bun run build && \
  HOST=127.0.0.1 NUXT_SESSION_COOKIE_SECURE=false TERMINA_TEST_HOOKS=1 node .output/server/index.mjs
#    …or, for quick local iteration: TERMINA_TEST_HOOKS=1 bun run dev

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
only **matchmaking** is bypassed. Every hook is gated on the explicit
**`TERMINA_TEST_HOOKS=1`** opt-in (`server/utils/testHooks.ts`): off by default,
404 + hard-return unless set, with a loud startup warning when enabled. (It used
to *also* require `NODE_ENV !== 'production'`, but e2e now runs against a
**production preview build**, so the env var is the sole gate — a real
deployment must never set it, since `login-as` mints a session for any username.)

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

### Continuous integration (GitHub Actions)

`.github/workflows/ci.yml` runs on every **push and pull request** as a set of
small, parallel, properly-named jobs:

- **Tier 1 (parallel, no services)** — `lint` (oxlint), `format` (oxfmt
  `--check`), `typecheck` (vue-tsc), `knip` (dead-code), `unit-tests`,
  `component-tests`. Each gives an independent red/green signal.
- **Tier 2** — `integration-tests` (vitest + Postgres) and `build` (nuxt build),
  gated on the cheap checks via `needs`.
- **`e2e`** — installs the `cairn` CLI from the public
  [cairntrace](https://github.com/abdul-hamid-achik/cairntrace) repo (it's not on
  npm) + Chromium, builds the app and starts the production preview server with
  the test hooks, runs the suite on the Playwright backend, and **uploads the
  Cairntrace `runs/` artifacts, the
  dev-server log, and the JUnit report** (downloadable from the Actions run, kept
  14 days). It is currently **advisory** — it reports its own status but is not
  part of the merge gate while it's being stabilized.
- **`ci-success`** — an aggregate job that fails if any required job did; make
  **this** the single required status check in branch protection.

**Resilience:** Postgres + Redis are started with `docker run` behind a
pull-retry loop rather than `services:` containers — `services:` image pulls run
before any step and can't be retried, so a transient Docker Hub pull failure
would hard-fail the job. Bun is pinned, the install + Playwright browser caches
are keyed on the lockfile, and each job has a `timeout-minutes` backstop.

---

## 🚢 Deployment

Production is a **two-provider split** (see [`infra/README.md`](infra/README.md)
for the full runbook):

- **Vercel** — the Nuxt frontend (CDN + SSR) **and** the data layer, provisioned
  via the Vercel Marketplace: **Neon** (Postgres) + **Upstash** (Redis).
- **DigitalOcean App Platform** — the full Nitro server (SSR + WebSocket +
  Effect-TS game loop + API), run from a DOCR Docker image. This is the one
  stateful, long-lived piece; the in-memory game state is pinned per instance and
  kept multi-instance-correct by the Redis relay, so it scales **up then out**.

The DigitalOcean side is **infrastructure-as-code with Pulumi (TypeScript)** in
[`infra/`](infra/) — an isolated project (own deps/tsconfig, excluded from the
app's lint/typecheck/knip/Docker build). Local + deploy secrets are managed with
**[tvault](https://github.com/abdul-hamid-achik/tinyvault)**, keyed by their real
env-var names so one project drives both:

```bash
tvault run -- bun run dev        # local dev with secrets injected
cd infra && tvault run -- pulumi up   # deploy DO App Platform
```

`infra/index.ts` reads each secret **env-var-first** (so tvault's injected vars
are used) and falls back to Pulumi config otherwise.

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
