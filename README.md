# TERMINA - Strategic Turn-Based MOBA

A text-based MOBA you play right in your browser — deep 5v5 strategy where
**reading the board beats reflexes**. No downloads, no waiting on a queue:
jump into a match against bots any time (a guided tutorial shows you the ropes),
or queue for ranked when you're ready. Built for players who love MOBA depth but
want it **accessible and at their own pace** — every command is one typed line,
every cycle is a decision.

**▶ Play it live: [www.terminamoba.com](https://www.terminamoba.com)** — or learn first: [meet the cast](https://www.terminamoba.com/cast) · [browse items](https://www.terminamoba.com/items) · [learn the commands](https://www.terminamoba.com/learn) · [read the lore](https://www.terminamoba.com/lore)

## 🎮 Features

### Core Gameplay
- **5v5 Strategic Battles** - Batch combat with 4-second cycles: every instruction commits at once, in no order
- **18 Unique Heroes** - Programming-themed operators with distinct abilities
- **47 Items** - Complete item system with passives and actives
- **Assigned Heroes** - Quick-match assigns heroes round-robin and bots fill empty slots after about ten seconds; there is no pick/ban draft (yet)
- **Talent Trees** - Four binary choices per hero (tiers named 10/15/20/25), unlocking at hero levels 3/6/9/12
- **Win Condition** - Destroy the enemy Terminal. It is firewalled until any one of that team's three T3 BLACK ICE falls, and a route's ICE falls in order, T1 then T2 then T3

### Strategic Mechanics
- **One main order per cycle** - Item use, talent picks, buyback and surrender ride their own slots; a move or an attack order keeps standing until replaced
- **Strip & Burn** - Waves at or below 35% of their spawn INTEG go to any swing (same-cycle claimants split the payload); burn your own wave at or below 50% to deny the enemy
- **Buyback** - Instant respawn for scrip (100 + 25×level + 10×deaths)
- **Surrender Voting** - 60% of a team's human players, from cycle 225 (15 minutes)
- **Vision Game** - Fog of war, camtap/sniffer placement, and a `missing` team callout
- **Cooldown Tracking** - See visible enemy ability timers

### Fair Play
- **AFK Takeover** - A player idle for 30 cycles (about 2 minutes) is replaced by a bot for the rest of the match
- **Rate Limiting** - 5 actions/second, 10 burst, enforced server-side
- **Server-side Validation** - Every action is validated against engine state; clients only ever receive vision-filtered state

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
move <zone>          # Walk to any zone; you auto-path one zone per cycle
```

**Combat:**
```
attack [target]      # hero:<name> | wave:<n> | ice:<zone> | tenant | terminal
cast <q|w|e|r> [target]   # Use ability
burn [wave:<n>]      # Burn your own wave (at or below 50% of its spawn INTEG)
```

**Items:**
```
buy <item>           # Purchase item (in your base or fountain)
sell <item>          # Sell an item for 50% of its cost
use <item>           # Use item active
```

**Map & objectives:**
```
tap <zone>           # Place a camtap or sniffer
grab                 # Pick up the cache in your zone
backup               # Pick up the Backup in the Tenant pit
harden               # Make your team's ICE invulnerable for a few cycles
```

**Strategy:**
```
buyback              # Instant respawn (when dead)
surrender confirm    # Vote to surrender (surrender cancel retracts it)
missing <enemy>      # Team callout: this enemy is missing
talent <10|15|20|25> <left|right>   # Choose a talent (tier names, not levels)
```

**Communication:**
```
chat all <message>   # Send to all players
chat team <message>  # Send to team only
```

### Game Flow

1. **Queue** - Join a ranked 5v5, quick 3v3 or 1v1 queue, or launch a practice game against bots
2. **Assignment** - Heroes are assigned round-robin; bots fill empty slots after about ten seconds
3. **Laning** - Last-hit (strip) waves, burn your own, harass
4. **Mid Game** - Team fights, objectives, ICE
5. **Late Game** - the Tenant, stacked waves, break a T3 and take the Terminal

---

## 📊 Game Systems

### Talent Trees

Each hero has 8 talents (2 choices × 4 tiers), tailored to that hero. The four
tiers are *named* 10, 15, 20 and 25 (the numbers you type), but they unlock at
hero levels **3, 6, 9 and 12**. Each pick is permanent; the other side of the
tier is gone for the match. Tiers mix stat bonuses, cooldown and damage
upgrades, and — at the top tier — a few "exotic" upgrades that change how an
ability works (a chance to cast twice, spell lifesteal, a global ultimate, an
area bonus). Browse every hero's tree on the `/cast` page.

```
talent 10 left       # pick the left option of the first tier (hero level 3)
```

### Strip & Burn

- **Strip window**: an enemy wave unit at or below 35% of its spawn INTEG goes down to *any* swing that cycle; everyone who swings the same cycle claims it together and splits the payload
- **Outside the window**: only a swing that would kill the unit outright claims it
- **Burn**: your own wave at or below 50% of its spawn INTEG; you keep 50% of the scrip and XP, the enemy gets nothing
- **Commands**: `attack wave:<n>` and `burn wave:<n>` (indices count living waves in your zone, so they shift every cycle)

### Buyback System

- **Cost**: 100 + (25 × level) + (10 × deaths)
- **Cooldown**: 90 cycles (6 minutes)
- **Effect**: Instant respawn at fountain, full HP/MP
- **Command**: `buyback`

### AFK Takeover

- **Detection**: 30 cycles (2 minutes) without actions
- **Effect**: a bot takes over the slot for the rest of the match (no reclaim) and the abandon is recorded

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

Thousands of Vitest tests across the engine, all 18 heroes, items, matchmaking,
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
for a solo queuer (the queue→game handoff isn't exercised in-browser; that path is
covered by the unit and gameplay suites).

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
3. Add the talent tree in `shared/constants/talents.ts`
4. Write tests in `tests/unit/heroes/`

### Adding a New Item

1. Define it in `shared/constants/items.ts` (the shop reads from there)
2. Wire its passive/active behavior in the engine (`server/game/items/shop.ts` for buying/selling/using, `server/game/engine/` for effects)
3. Write tests

### Adding a New Game Mode

1. Add mode to `shared/types/game.ts`
2. Implement matchmaking in `server/game/matchmaking/queueNeon.ts`
3. Adjust rules in `server/game/engine/GameLoop.ts`
4. Update frontend in `app/pages/play.vue` and `app/pages/lobby.vue`

---

## 📈 Performance

- **Cycle length**: 4 seconds, driven one tick at a time by Vercel Workflow
- **Players per game**: up to 10 (5v5), human or bot
- **State**: one `live_games` row per game in Neon, updated under a CAS guard each tick; slow cycles are logged with their duration

---

## 🛡️ Security

- Authentication required (no bot bypass)
- Rate limiting (5 actions/sec, 10 burst)
- Vision-filtered state: clients never receive enemies they cannot see
- Every action is validated server-side against engine state

---

## 📝 License

No open-source license is included in this repository.

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

## 📞 Support

- **Email**: support@terminamoba.com
