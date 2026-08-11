# TERMINA - Strategic Turn-Based MOBA

A text-based MOBA you play right in your browser — deep 5v5 strategy where
**reading the board beats reflexes**. No downloads, no waiting on a queue:
jump into a match against bots any time (a guided tutorial shows you the ropes),
or queue for ranked when you're ready. Built for players who love MOBA depth but
want it **accessible and at their own pace** — every command is one keystroke,
every cycle is a decision.

**▶ Play it live: [www.terminamoba.com](https://www.terminamoba.com)** — or learn first: [meet the cast](https://www.terminamoba.com/cast) · [browse items](https://www.terminamoba.com/items) · [learn the commands](https://www.terminamoba.com/learn) · [read the lore](https://www.terminamoba.com/lore)

## 🎮 Features

### Core Gameplay
- **5v5 Strategic Battles** - Batch combat with 4-second cycles
- **18 Unique Heroes** - Programming-themed champions with distinct abilities
- **40+ Items** - Complete item system with passives and actives
- **Draft Phase** - Alternating hero picks (snake draft)
- **Talent Trees** - Binary choices at levels 10/15/20/25 for build diversity

### Strategic Mechanics
- **Burn System** - Burn allied waves below 50% HP to deny the enemy scrip/XP
- **Buyback** - Instant respawn for scrip (100 + 25×level)
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
- **State Persistence** - each game's state lives in a Postgres row, updated every tick under a CAS guard — no separate snapshot/recovery step
- **Vercel Workflow** - drives each game's 4-second tick durably (survives cold starts/deploys)
- **Effect-TS** - Type-safe functional programming
- **Ably** - Real-time communication
- **PostgreSQL** - Match history, stats, and live game state (Neon)

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
│   │   ├── engine/         # Game loop (processCycle), state management
│   │   ├── heroes/         # Hero abilities, talent trees
│   │   ├── items/          # Item system
│   │   ├── matchmaking/    # Neon-backed queue, party, live-game start
│   │   └── ai/             # Bot AI
│   ├── services/           # DatabaseService (Effect), LeaverSystem (AFK detection)
│   ├── workflows/          # gameTick.ts (Vercel Workflow) + gameTickCore.ts
│   └── plugins/            # game-server.ts (minimal boot: heroes registry + DB layer)
├── shared/                 # Shared types & constants (+ shared/types/*.d.ts augmentations)
└── tests/                  # Vitest (unit/integration/component) + Cairntrace (E2E)
```

### Technology Stack
- **Frontend**: Nuxt 4, Vue 3, Pinia 3, Tailwind 4
- **Backend**: Nitro (Nuxt server), Effect-TS, Vercel Workflow DevKit
- **Database**: PostgreSQL (Neon in prod) + Drizzle ORM
- **Real-time**: Ably (Realtime client, REST publish)
- **Runtime**: Bun
- **Tooling**: oxlint (lint) · oxfmt (format) · knip (dead-code) · lefthook (git hooks)
- **Testing**: Vitest (unit/integration/component) · Cairntrace (browser E2E, real flows)

---

## 🚀 Getting Started

### Prerequisites
- Bun (latest)
- PostgreSQL 14+

### Installation

```bash
# Install dependencies
bun install

# Copy environment variables
cp .env.example .env

# Start the database (Docker)
docker-compose up -d

# Push the schema (schema.ts is the source of truth — no migration files)
bun run db:push

# Start development server
bun run dev
```

### Environment Variables

```env
# Session
NUXT_SESSION_PASSWORD=your-secret-password-at-least-32-chars

# OAuth (optional)
NUXT_OAUTH_GITHUB_CLIENT_ID=
NUXT_OAUTH_GITHUB_CLIENT_SECRET=
NUXT_OAUTH_DISCORD_CLIENT_ID=
NUXT_OAUTH_DISCORD_CLIENT_SECRET=

# Ably (realtime) — mints per-player tokens + publishes cycle_state
ABLY_API_KEY=

# Database (host port 5433 — off the default 5432 so it can run alongside
# another project's Postgres; override the host port via TERMINA_POSTGRES_PORT)
DATABASE_URL=postgresql://termina:termina@localhost:5433/termina
```

See `.env.example` for the complete list (incl. `WORKFLOW_START_KEY`).

---

## 🎯 How to Play

### Game Commands

**Movement:**
```
move <zone>          # Move to adjacent zone
```

**Combat:**
```
attack <target>      # Attack hero/wave/ice
cast <q|w|e|r>       # Use ability
burn <wave_index>   # Burn allied wave (<50% HP)
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
3. **Laning** - Last-hit waves, burn, harass
4. **Mid Game** - Team fights, objectives, ICE
5. **Late Game** - the Tenant, stacked waves, base race

---

## 📊 Game Systems

### Talent Trees

Each hero has 8 talents (2 choices × 4 tiers):

**Level 10** - Stat bonuses (+15 Attack or +200 HP)
**Level 15** - Ability enhancements (+damage or -cooldown)
**Level 20** - Major power spikes (+30% damage or +25% resist)
**Level 25** - Exotic upgrades: a few heroes get a mechanical transform — e.g.
Echo's _Double Echo_ / Lambda's _Double Cast_ (Q has a 25% chance to fire twice),
Daemon's _Soul Siphon_ (ability damage heals you), Regex's _Global Backtracking_
(R can target a hero in any zone), and Null's _Cascading Dereference_ (R also hits
adjacent zones). The rest are large numeric bonuses

Example (Echo):
```
Level 10: +15 Attack Damage OR +200 HP
Level 15: Echo Stun +0.5s OR -2s Echo Location CD
Level 20: +30% Echo Damage OR +15% Magic Resist
Level 25: Double Echo (Q casts twice, 25%) OR +250 Max HP
```

### Deny Mechanics

- **When**: Allied wave below 50% HP
- **Reward**: 50% scrip + 50% XP
- **Prevention**: Enemy gets nothing
- **Command**: `burn <wave_index>`

### Buyback System

- **Cost**: 100 + (25 × level) + (10 × deaths)
- **Cooldown**: 90 cycles (6 minutes)
- **Effect**: Instant respawn at fountain, full HP/MP
- **Command**: `buyback`

### Leaver Penalties

- **Detection**: 30 cycles (2 minutes) without actions
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

### End-to-end (Cairntrace)

Browser E2E uses [Cairntrace](https://github.com/abdul-hamid-achik/cairntrace)
YAML flows that drive the **real app** — each flow registers/logs in a user
through the UI, navigates, and asserts on what renders. There are **no test seed
hooks**: the flows cover UI + auth + navigation journeys (auth, nav, lobby queue,
profile, mobile), while gameplay/engine truth lives in the in-process `bun run
test:gameplay` harness (seed scenario → act → advance cycles → assert engine
truth, no browser). The easy path is `bun run test:e2e`, which is just `cairn run
tests/e2e/flows --config … --cold-start`: cairn's `webServer:` config block
(cairntrace ≥1.11.0) builds the app and boots a **production preview server**
(`node .output/server`, IPv4), runs the suite, and tears it down — replacing the
old `scripts/e2e.mjs`. The prod preview avoids `nuxt dev`'s Vite-proxy /
cold-compile / IPv6 flakiness. To drive `cairn` by hand against a server you
already have on `:3000`, drop `--cold-start` (it reuses a running server).

The preview server is booted with two **test-only** env flags (set in
`cairntrace.config.yml`, never in production): `TERMINA_DISABLE_RATE_LIMIT=1` +
`TERMINA_TEST_HOOKS=1` together relax the per-IP auth rate limit, so a parallel
run can register many users from one IP without hitting the 5/burst 429;
`TERMINA_TEST_HOOKS=1` also turns DevTools off (a cold Vite cache can otherwise
re-optimize deps mid-navigation and yank the page out from under the browser).
`TERMINA_TEST_HOOKS` no longer enables any endpoint — the old `/api/test/*` seed
routes were removed.

```bash
# whole suite (= `bun run test:e2e`; add --junit --stamp-if-green for CI = test:e2e:ci)
cairn run tests/e2e/flows --config tests/e2e/cairntrace.config.yml --cold-start

# one flow · lint+stamp a contract · heal selectors after a UI rename
cairn run        tests/e2e/flows/profile_view.yml --config tests/e2e/cairntrace.config.yml --cold-start
cairn spec verify tests/e2e/flows/profile_view.yml --config tests/e2e/cairntrace.config.yml --stamp
cairn spec heal   tests/e2e/flows/profile_view.yml
```

`tests/e2e/` holds `flows/` (one behaviour per file, self-documenting headers), a
reusable `actions/login.yml` (registers a fresh user through the /login Register
tab), `cairntrace.config.yml`, and a gitignored `runs/` artifact root.
`lobby_queue` is tagged `partial`: it covers the idle→searching→cancel UI journey
for a solo queuer (a real match needs 10 players, so the draft→game handoff isn't
exercised in-browser).

**Auth & isolation:** flows authenticate for real — `actions/login.yml` registers
a username/password account through the /login Register tab (which logs you in on
success). `testUser` is `${run.token}` — a unique per-flow token, kept ≤20 chars
(the app's username limit), so parallel flows and re-runs never collide on a taken
username. The preview server points at an isolated `termina_test` Postgres database
(the same one `test:db` provisions), so a prior run's rows can't bleed into a
fresh one.

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

**Resilience:** Postgres is started with `docker run` behind a pull-retry loop
rather than a `services:` container — `services:` image pulls run before any
step and can't be retried, so a transient Docker Hub pull failure would
hard-fail the job. Bun is pinned, the install + Playwright browser caches are
keyed on the lockfile, and each job has a `timeout-minutes` backstop.

---

## 🚢 Deployment

Production is **all-Vercel** — the DigitalOcean split (a Pulumi-provisioned App
Platform Nitro server + a WebSocket game loop) was demolished after the cutover
to this architecture; there is no `infra/`, no Dockerfile, no separate API
origin to deploy.

- **Vercel** hosts the Nuxt frontend (SSR + all `/api/*` routes, same-origin) at
  `www.terminamoba.com`, backed by **Neon** (Postgres) via the Vercel
  Marketplace integration.
- **Vercel Workflow DevKit** drives each game's 4-second tick durably — see
  `server/workflows/gameTick.ts` (the statically-bundled workflow body) and
  `gameTickCore.ts` (the heavy step bodies: read/write the game's row in Neon
  under a CAS guard, run `processCycle`, publish to Ably). There is no
  in-memory single-authoritative-instance loop anymore, and no horizontal
  scaling concern in the old sense — each tick is its own step, schedulable on
  any warm (or cold) instance.
- **Ably** is the realtime transport (Realtime for the client, REST for the
  server-side publish from each tick).
- **Matchmaking** is Neon-backed and event-driven (no background sweep — a
  serverless function can't keep one warm); see `server/game/matchmaking/
  queueNeon.ts`.

Local dev secrets are managed with
**[tvault](https://github.com/abdul-hamid-achik/tinyvault)** (project
`termina-local`); prod secrets are Vercel environment variables:

```bash
tvault -p termina-local run -- bun run dev   # local dev with secrets injected
```

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
2. Implement matchmaking in `server/game/matchmaking/queueNeon.ts`
3. Adjust rules in `server/game/engine/GameLoop.ts`
4. Update frontend in `app/pages/play/`

---

## 📈 Performance

### Current Capabilities
- **Tick Rate**: 4 seconds (250ms planned for future)
- **Players per Game**: 10 (5v5)
- **Concurrent Games**: ~50 per server instance (estimate — slow cycles are
  logged with their duration so the real ceiling is observable)
- **Memory**: ~100MB per active game

### Optimization Roadmap
- [~] Delta compression for state updates (partial: top-level field diff;
  per-entity dirty-tracking is the remaining work)
- [ ] Vision calculation caching
- [ ] Horizontal scaling (sharding) — single-instance today
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
