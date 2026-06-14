# Termina e2e (Cairntrace)

Termina's browser e2e suite, written in [Cairntrace](https://github.com/abdul-hamid-achik/cairntrace)
(`~/projects/cairntrace`) and paired with **dev-only seed hooks** so a spec lands
in an exact game/draft state instead of playing a flaky bot match. This one file
is the whole guide: the suite, how to run it, the seed hooks, and the findings.

**Status:** this is the e2e suite — it replaced the old Playwright suite that used
to live here. **29 flows run green** from a cold-started browser
(`cairn run tests/e2e/flows --cold-start` → 29/29, ~7m30s; each flow is ~7–40s vs
~90s of flaky matchmaking per Playwright game spec). The flow files in `flows/`
are self-documenting — each has a header comment saying what it seeds and asserts.

## Coverage

All **28** behaviours from the old Playwright suite are covered (one cairntrace
flow per behaviour, plus the seeded screen/objectives flows). Two are `partial`,
each for a reason that isn't seedable today:

- `game_websocket_connection` — covers connect-on-mount (`[ONLINE]`); the original
  also asserted an outbound `join_game` WS frame, which needs a cairntrace
  WS-frame verifier that doesn't exist yet.
- `lobby_queue` — covers the live queue UI band (idle→searching→cancel). The
  literal live-matchmaker queue→match-found transition isn't seeded; everything
  downstream (the hero draft and draft→game) is covered deterministically by
  `lobby_hero_pick` + `lobby_matchmaking_to_game` via the `new-draft` hook.

## Layout

```
tests/e2e/
  cairntrace.config.yml      # envs (local/ci), vars, artifactRoot, baseUrl
  README.md                  # this file — the only doc
  actions/
    login.yml                # open / → request /api/test/login-as       (reusable)
    new_game.yml             # request /api/test/new-game → open ${url}   (reusable)
  flows/                     # 29 flows, one behaviour each. Highlights:
    game_screen_renders.yml  #   seed → assert Theater / War Room / macro strip
    combat_log_beats.yml     #   seed + advance N ticks → assert per-tick beats
    objectives_seeded.yml    #   seed Roshan dead → assert ticker + engine truth
    game_death_overlay.yml   #   seed self_dead → assert "PROCESS TERMINATED"
    game_over.yml            #   seed → force-end → assert post-game + return home
    game_spectator.yml       #   seed → spectate as a 2nd user → assert tick/scores
    lobby_hero_pick.yml      #   seed draft (new-draft) → assert grid/turn/picks/CONFIRM
    lobby_matchmaking_to_game.yml # seed draft → confirm → real pipeline → /play
    nav_*.yml auth_*.yml      #   public pages, login/register/logout, protected routes
    profile_*.yml mobile_*.yml #  profile view/settings; mobile viewport + overflow
    smoke_full_session.yml   #   seeded home→game→over→profile→logout journey
    # … 29 flows total; each file's header comment says what it seeds + asserts
  runs/                      # artifact root (gitignored)
```

The dev hooks themselves live in the app at `server/api/test/*`, not here — this
layer only calls them. The engine-side seeding (`createDevGame`, `advanceDevGame`,
`seedDraftLobby`, scenarios) is in `server/plugins/game-server.ts`,
`server/game/matchmaking/lobby.ts`, `server/game/dev/scenarios.ts`, and
`server/game/engine/GameLoop.ts` (`runOneTick`).

## Quick start

Cairntrace does not start the app — bring up a dev server with the test hooks
first, then point `cairn` at the already-running server.

```bash
# 1. dev server with hooks on (test DB + isolated redis)
TERMINA_TEST_HOOKS=1 NUXT_DATABASE_URL=postgresql://termina:termina@localhost:5432/termina_test \
  NUXT_REDIS_URL=redis://localhost:6379/1 bun run dev

# 2. lint a spec's contract
cairn spec verify tests/e2e/flows/game_screen_renders.yml --config tests/e2e/cairntrace.config.yml

# 3. run one flow from a clean browser (the cold-start gate)  — same as `bun run test:e2e` for one spec
cairn run tests/e2e/flows/game_screen_renders.yml --config tests/e2e/cairntrace.config.yml --cold-start

# 4. whole suite (= `bun run test:e2e`); add --junit --stamp-if-green for CI (= `bun run test:e2e:ci`)
cairn run tests/e2e/flows --config tests/e2e/cairntrace.config.yml --cold-start

# 5. read the handoff summary / inspect artifacts
cairn context latest --config tests/e2e/cairntrace.config.yml

# 6. after a UI rename, propose selector fixes without touching the contract
cairn spec heal tests/e2e/flows/game_screen_renders.yml
```

`cairn run <dir>` runs only the `flows/` specs and skips imported `actions/`.
Stamp a spec's `contractHash` (`--stamp-if-green`, or `cairn spec verify --stamp`)
only after its first green `--cold-start` run.

## Dev seed hooks (`server/api/test/*`)

> The point: **stop having to play the game to test it.** These hooks build a
> **real** `GameState` through the same `createGame` + `startGameLoop` path the
> lobby uses — so a seeded game is a real game (same tick pipeline, vision, win
> condition). We bypass only **matchmaking**, the flaky part we don't need to
> re-test every spec.

Every hook is **double-gated** exactly like `force-end.post.ts`:
`NODE_ENV !== 'production' && TERMINA_TEST_HOOKS === '1'`. In production every
route 404s and the exported helpers hard-return. They're trusted test surfaces,
not features. All POST unless noted, all returning JSON.

| Route | Body | Returns | Purpose |
| --- | --- | --- | --- |
| `login-as` | `{ username }` | `{ playerId }` | Mint a session cookie for a dev user (create if missing). No register/OAuth dance. Username is `\w{3,40}` (widened from 20 so `cairn_${run.token}` fits). |
| `new-game` | `{ scenario?, heroSelf?, seed?, manualTick? }` | `{ gameId, playerId, url }` | Build a real 5v5 (session user + 9 bots), apply the scenario, start the loop, return the `/play` entry URL. **Skips matchmaking.** |
| `new-draft` | `{ prepick? }` | `{ lobbyId, playerId, team, currentPickIndex, url }` | Seed a hero-DRAFT lobby frozen at the session user's pick turn (`prepick` snake slots already taken by bots). Open `url` (/lobby); the client recovers the draft on connect. The human's pick runs the **real** `pickHero`→`game_ready`→`createGame` pipeline. `prepick: 5` ⇒ mid-draft (hero-pick UI); `prepick: 9` ⇒ final picker (one confirm ⇒ draft→game). **Skips the live matchmaker.** |
| `advance` | `{ gameId, ticks }` | `{ advanced, tick }` | Step a `manualTick` game N ticks immediately (deterministic) instead of waiting 4s/tick. |
| `state` (GET) | `?gameId=` | `GameState` JSON | Engine-truth snapshot for `httpJson`/`script` verifiers + golden diffing. |
| `force-end` | `{ gameId, winner }` | `{ ended }` | End a live game with a winner → the post-game screen renders near-instantly. |

### Named scenarios (`applyScenario`, `server/game/dev/scenarios.ts`)

Each scenario is a pure `(state, opts) => GameState` transform applied right after
`createGame` — a small, greppable, unit-tested catalog instead of a god-mode
"set any field" endpoint. **Implemented today** (`KNOWN_SCENARIOS`):

| Scenario | What it sets up | Unlocks testing |
| --- | --- | --- |
| `fresh` / `laning` | a fresh playing game (no shaping yet) | spawn / first-tick UI, combat log, map presence |
| `roshan_dead` | Roshan slain at the current tick (`deathTick` set) | objective ticker Roshan respawn timer |
| `core_vulnerable` | a Dire T3 down so the enemy Ancient is `vulnerable` | macro-strip Core urgency, win-condition proximity |
| `night` | `timeOfDay: night` | day/night readout + vision meaning |
| `self_dead` | the **human** player `alive:false, hp:0, respawnTick:tick+30` | death overlay ("PROCESS TERMINATED"); seed with `manualTick:true` so the respawn handler never revives them. Needs `humanId` → `applyScenario(state, scenario, { humanId })`. |

Add scenarios here as a spec needs one (e.g. `teamfight`, `rune_live`,
`can_buyback`, `ahead`/`behind` are obvious next ones) — keep each a minimal,
legal mutation of a real `GameState`, never an impossible state.

### How a flow drives the hooks

Prefer the `request` step (in-session, captured, spliced). The reusable actions
do the cold-start setup:

```yaml
# actions/new_game.yml — login + seed, used via `use: new_game`
steps:
  - id: login
    request: { method: POST, url: /api/test/login-as, body: { username: "${vars.testUser}" }, expectStatus: 200 }
  - id: seed
    request:
      method: POST
      url: /api/test/new-game
      body: { scenario: "${vars.scenario}", heroSelf: "${vars.heroSelf}", seed: 1337, manualTick: "${vars.manualTick}" }
      expectStatus: 200
      assign: game            # → ${requests.game.body.gameId} / .url
  - id: enter
    open: { path: "${requests.game.body.url}", waitUntil: networkidle }
```

```yaml
# inside a flow: advance ticks, then cross-check the DOM against engine truth
steps:
  - use: new_game
  - request: { method: POST, url: /api/test/advance, body: { gameId: "${requests.game.body.gameId}", ticks: 5 } }
outcomes:
  - id: engine_agrees
    verify:
      httpJson: { url: "/api/test/state?gameId=${requests.game.body.gameId}", jsonPath: "$.roshan.alive", equals: false }
```

## Determinism & isolation

- **Seeded state, not played games.** A flow `request`s `/api/test/new-game` (or
  `new-draft`) with a `scenario` and lands directly on `/play` (or the draft).
- **Manual ticks.** Specs that assert tick progression pass `manualTick: true`,
  then `request` `/api/test/advance` to step the engine an exact number of ticks —
  no 4s wall-clock waits, no bot-driven nondeterminism.
- **Per-run identity.** `testUser` is `cairn_${run.token}` in the config — a
  cairntrace v1.9 runtime placeholder that expands to a unique token per run (and
  per parallel worker). Termina broadcasts game state per user id over WebSocket,
  so sharing one user across specs lets a still-running game loop clobber another
  spec's seeded state; per-run identity removes that race without hand-assigning a
  username to each flow. A flow needing a 2nd identity (e.g. a non-participant
  spectator) logs in again as `spec_${run.token}`.
- **Redis hygiene.** Each seeded game persists to redis db1 and resumes on boot;
  across runs these accumulate into zombie game loops. Flush between sessions:
  `redis-cli -n 1 FLUSHDB` (or a `preconditions.commands` step).

## Saving assets + reports

Cairntrace writes a self-contained pack per run under `tests/e2e/runs/<run-id>/`:

| Artifact | What it's for |
| --- | --- |
| `run.md` / `run.json` / `run.yaml` | the run result (outcomes pass/fail, steps, timings) |
| `agent_context.md` | compact handoff summary (`cairn context latest`) for a human or agent |
| `outcomes/<id>.md` (+ `.raw.json`) | per-outcome evidence (the `script`/`httpJson` JSON *is* the golden) |
| `snapshots/` `screenshots/` | DOM a11y snapshots (`snapshot` steps) + screenshots (on-failure by default) |
| `console/` `network/` `requests/` | console logs, HTTP log, captured seed/advance responses |
| `diagnostics/` | on failure: current URL, visible controls, nearby text, selector counts |

- **Engine-truth checks:** the `httpJson` verifier hits `/api/test/state` and
  asserts an engine field, so every DOM assertion is cross-checked against the
  engine.
- **Regression diff:** `cairn diff <runA> <runB>` structurally compares two runs
  (outcomes/steps/console/network). With seeded RNG (Phase B) this becomes exact.
- **Retention:** `retention.keepRuns` prunes automatically; `cairn clean --all`.
- **CI:** gate on exit codes (`0` pass · `1` outcome fail · `3` cold-start gate ·
  `4` lint · `6` contract drift). `--junit` emits a suite rollup for CI reporters.

## Rollout checklist

- [x] **A1** — `login-as` + `createDevGame` + `new-game` + the `?gameId` entry in
      `play.vue`. `game_screen_renders.yml` green with `--cold-start`.
- [x] **A2** — `server/game/dev/scenarios.ts` catalog + unit tests per transform.
- [x] **A3** — `runOneTick` + `/api/test/advance` + `/api/test/state`;
      `combat_log_beats.yml` + `objectives_seeded.yml` green.
- [x] **A4 (v1.9)** — per-run identity (`cairn_${run.token}`, login regex widened
      to 40), `self_dead` scenario for the death overlay. 3 seed flows refactored.
- [x] **Port the backlog** — 24 flows ported across two waves (auth, nav, profile,
      mobile, the game screens, death/over/spectator/chat/ws, lobby queue, seeded
      smoke). See **Coverage** for the two partials.
- [x] **Unblock lobby** — `/api/test/new-draft` + `seedDraftLobby` seed a hero draft
      frozen at the player's turn; `lobby_hero_pick` + `lobby_matchmaking_to_game`
      cover the draft and the draft→game handoff. (`ws.ts` now also re-sends
      `pick_turn` on reconnect — a real draft-refresh fix.) **29/29 green.**
- [x] **Fix `/learn` mobile overflow** — `TerminalPanel` `min-w-0` + `table-fixed`
      reference tables; all four public pages now fit 390px.
- [ ] **B (replicability)** — replace the engine's ~9 `Math.random()` call sites
      with a per-game seeded PRNG (init from `new-game`'s `seed`), so `seed: 1337`
      ⇒ byte-identical bot/crit/spawn outcomes and `cairn diff` becomes an exact
      regression gate on seeded runs.

## Cairntrace v1.9 findings (for the cairntrace repo)

Footguns this suite hit — none blocked us (each has a workaround in the flows),
but they belong upstream in `~/projects/cairntrace`:

1. **`${...}` substitution doesn't reach `script.run` bodies or outcome `verify`
   blocks** — only steps. Workaround: read ids from `window.location.search` in a
   script; pin `seed: 1337` and regex-match the gameId in an outcome.
2. **Per-spec `viewport` resets to the env default during the outcome-script
   phase** — a `script` measuring `window.innerWidth` silently reads desktop
   width. Workaround (`mobile_no_overflow`): render into a forced-width iframe and
   guard on `innerWidth === 390`.
3. **`cairn spec verify --stamp` cosmetics** — clips an `intent:` at a literal `#`
   and folds `|` script blocks to `>`. Harmless if every JS statement ends in `;`
   and `intent` avoids `#`; the `contractHash` stays stable.
4. **No WS-frame-capture verifier** — can't assert an outbound WS frame (see the
   `game_websocket_connection` partial).

## Hook safety checklist

- Double gate every hook: `NODE_ENV !== 'production' && TERMINA_TEST_HOOKS === '1'`
  at the route, and a `production` hard-return in any exported helper (mirror
  `forceEndGame`).
- No secrets/tokens in responses or artifacts; keep `state` to game data only.
- `login-as` only mints `provider: 'local'` dev users; never elevates a real account.
- Routes are invisible (404) without the opt-in, so a normal dev session that
  didn't set `TERMINA_TEST_HOOKS=1` can't probe them.

## Why this is worth it (one line)

A game spec used to replay ~90s of flaky matchmaking and could only assert what
the bots happened to do; with seed hooks + cairntrace, a spec lands in an exact,
named state in milliseconds and asserts the screen **and** the engine — faster,
deterministic, and self-healing.
