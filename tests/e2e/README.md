# Termina e2e (Cairntrace)

Termina's browser e2e suite, written in [Cairntrace](https://github.com/abdul-hamid-achik/cairntrace)
(`~/projects/cairntrace`) and paired with **dev-only seed hooks** so specs land
in an exact game state instead of playing a real bot match.

**Status:** this is the e2e suite — it replaced the old Playwright suite that used
to live here. **29 flows run green** from a cold-started browser
(`cairn run tests/e2e/flows --cold-start` → 29/29, ~7m30s; each flow is ~7–40s vs
~90s of flaky matchmaking per Playwright game spec).

See **[DEV-HARNESS.md](./DEV-HARNESS.md)** for the dev-only, double-gated seed
hooks (`login-as`, `new-game`, `new-draft`, `advance`, `state`, `force-end`), the
scenario catalog, and per-run identity — the machinery that lets a spec land in
an exact game/draft state instead of playing a real match. The flow files in
`flows/` are self-documenting (each has a header comment explaining what it seeds
and asserts).

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
  README.md DEV-HARNESS.md
  actions/
    login.yml                # open / → request /api/test/login-as       (reusable)
    new_game.yml             # request /api/test/new-game → open ${url}   (reusable)
  flows/                     # 27 flows, one behaviour each. Highlights:
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

The dev hooks themselves live in the app at `server/api/test/*` (gated exactly
like the existing `force-end.post.ts`), not here — this layer only calls them.
The engine-side seeding (`createDevGame`, `advanceDevGame`, scenarios) is in
`server/plugins/game-server.ts`, `server/game/dev/scenarios.ts`, and
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

## Determinism & isolation

- **Seeded state, not played games.** Each flow `request`s `/api/test/new-game`
  with a `scenario` (e.g. `roshan_dead`, `laning`) and lands directly on `/play`.
- **Manual ticks.** Specs that assert tick progression pass `manualTick: true`,
  then `request` `/api/test/advance` to step the engine an exact number of ticks
  — no 4s wall-clock waits, no bot-driven nondeterminism.
- **Per-run identity.** `testUser` is `cairn_${run.token}` in the config — a
  cairntrace v1.9 runtime placeholder that expands to a unique token per run (and
  per parallel worker). Termina broadcasts game state per user id over WebSocket,
  so sharing one user across specs lets a still-running game loop clobber another
  spec's seeded state; per-run identity removes that race without hand-assigning a
  username to each flow. (A flow that needs a 2nd identity — e.g. a spectator —
  logs in again as `spec_${run.token}`.)

## Saving assets + reports

Cairntrace writes a self-contained pack per run under `tests/e2e/runs/<run-id>/`:

| Artifact | What it's for |
| --- | --- |
| `run.md` / `run.json` / `run.yaml` | the run result (outcomes pass/fail, steps, timings) |
| `agent_context.md` | compact handoff summary (`cairn context latest`) for a human or agent |
| `outcomes/<id>.md` (+ `.raw.json`) | per-outcome evidence |
| `snapshots/` `screenshots/` | DOM a11y snapshots (`snapshot` steps) + screenshots (on-failure by default) |
| `console/` `network/` `requests/` | console logs, HTTP log, captured seed/advance responses |
| `diagnostics/` | on failure: current URL, visible controls, nearby text, selector counts |

Verification + regression tooling:

- **Engine-truth checks:** the `httpJson` verifier hits `/api/test/state` and
  asserts an engine field (e.g. `$.roshan.alive == false`), so every DOM
  assertion is cross-checked against the engine — the JSON state *is* the golden.
- **Regression diff:** `cairn diff <runA> <runB>` structurally compares two runs
  (outcomes/steps/console/network). With seeded-RNG this becomes an exact gate.
- **Retention:** `retention.keepRuns` prunes automatically; `cairn clean --all`.
- **CI:** gate on exit codes (`0` pass · `1` outcome fail · `3` cold-start gate ·
  `4` lint · `6` contract drift). `--junit` emits a suite rollup for CI reporters.

## Rollout checklist

- [x] **A1** — `login-as` + `createDevGame` + `new-game` + the `?gameId` entry in
      `play.vue`. `game_screen_renders.yml` green with `--cold-start`.
- [x] **A2** — `server/game/dev/scenarios.ts` catalog (`roshan_dead`,
      `core_vulnerable`, `night`) + unit tests for each transform.
- [x] **A3** — `runOneTick` + `/api/test/advance` + `/api/test/state`;
      `combat_log_beats.yml` + `objectives_seeded.yml` green.
- [x] **A4 (v1.9)** — per-run identity (`cairn_${run.token}`, login regex widened
      to 40), `self_dead` scenario for the death overlay. 3 seed flows refactored.
- [x] **Port the backlog** — 24 flows ported across two waves (auth, nav,
      profile, mobile, the game screens, death/over/spectator/chat/ws, lobby
      queue, seeded smoke). See **Coverage** above for the two partials.
- [x] **Unblock lobby** — `/api/test/new-draft` seeds a hero draft frozen at the
      player's turn; `lobby_hero_pick` + `lobby_matchmaking_to_game` cover the draft
      and the draft→game handoff. (`ws.ts` now also re-sends `pick_turn` on
      reconnect — a real draft-refresh fix.) **29/29 green together.**
- [x] **Fix `/learn` mobile overflow** — `TerminalPanel` `min-w-0` + `table-fixed`
      reference tables; all four public pages now fit 390px.
- [ ] **B** — seeded PRNG across the engine; turn on `cairn diff` regression gates.

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

## Why this is worth it (one line)

A game spec used to replay ~90s of flaky matchmaking and could only assert what
the bots happened to do; with seed hooks + cairntrace, a spec lands in an exact,
named state in milliseconds and asserts the screen **and** the engine — faster,
deterministic, and self-healing.
