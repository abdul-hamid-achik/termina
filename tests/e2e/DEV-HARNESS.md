# Dev test harness — seedable, replicable game state

> The point: **stop having to play the game to test it.** The old Playwright
> suite had to drive real matchmaking (a ~90s, flaky game fixture) and then hope
> the bots wandered into the state it wanted to assert. Instead, expose dev-only
> HTTP hooks that build a **real** `GameState` directly, seed it into a named
> scenario, and (optionally) step ticks on demand — so a spec lands in an exact,
> repeatable state in milliseconds.
>
> Everything here is **dev/test-only**, gated exactly like the existing
> `server/api/test/force-end.post.ts`: `NODE_ENV !== 'production' &&
> TERMINA_TEST_HOOKS === '1'`. In production every route 404s and every
> exported helper hard-returns. These are trusted test surfaces, not features.

## Design principles

1. **Real engine, not a fake.** Hooks build state through the same
   `stateManager.createGame()` + `startGameLoop()` path the lobby uses
   (`server/plugins/game-server.ts`), so a seeded game is a *real* game — same
   tick pipeline, vision, win condition. We bypass only **matchmaking**, which
   is the flaky, non-deterministic part we don't need to re-test every spec.
2. **Seed in, same game out (replicable).** A `seed` makes a run reproducible.
   Today the engine calls `Math.random()` in ~9 places (spawner, shop, BotAI,
   GoldDistributor, ActionResolver, NeutralAI, kernel, queue, lobby), so bot
   behavior isn't yet deterministic. The harness is useful **without** that
   (deterministic *creation* + *scenarios* gets ~90% of the value); full
   replay-determinism is Phase B (a per-game seeded PRNG, below).
3. **Scenarios over arbitrary mutation.** Rather than a god-mode "set any field"
   endpoint (huge surface, easy to make impossible states), ship a small set of
   **named scenarios** that transform a fresh game into a known shape, plus a
   narrow `patch` for the few per-player knobs specs actually need
   (gold/level/hp/zone/items/cooldowns).
4. **Observable + verifiable.** A `state` snapshot endpoint returns the
   `GameState` (or a vision-filtered view) as JSON so a cairntrace `script`
   verifier can assert engine truth, and so runs can be golden-compared.

## Endpoint surface (`server/api/test/*`)

All POST unless noted, all double-gated, all returning JSON.

| Route | Body | Returns | Purpose |
| --- | --- | --- | --- |
| `login-as` | `{ username }` | `{ playerId }` | Mint a session cookie for a dev user (create if missing). Replaces the register/login dance + OAuth. |
| `new-game` | `{ scenario?, heroSelf?, seed?, fastGame?, bots? }` | `{ gameId, playerId, url }` | Build a real 5v5 (session user + bots), seed the scenario, start the loop. **Skips matchmaking.** |
| `new-draft` | `{ prepick? }` | `{ lobbyId, playerId, team, currentPickIndex, url }` | Seed a hero-DRAFT lobby frozen at the session user's pick turn (`prepick` snake slots already taken by bots). Open `url` (/lobby); the client recovers the draft on connect. The human's pick runs the **real** `pickHero`→`game_ready` pipeline (remaining bots auto-pick, the game is created). `prepick: 5` ⇒ mid-draft (hero-pick UI); `prepick: 9` ⇒ final picker (one confirm ⇒ draft→game). **Skips the live matchmaker.** See `seedDraftLobby` in `server/game/matchmaking/lobby.ts`. |
| `advance` | `{ gameId, ticks }` | `{ tick }` | Step the game loop N ticks immediately (deterministic), instead of waiting wall-clock 4s/tick. |
| `scenario` | `{ gameId, scenario }` | `{ ok }` | Re-seed an existing game into a named scenario mid-run. |
| `patch` | `{ gameId, players?: [{ id?, self?, gold?, level?, hp?, zone?, items?, cooldowns? }], roshan?, runes?, aegis? }` | `{ ok }` | Narrow per-entity overrides for the knobs specs need. |
| `state` (GET) | `?gameId=&for=self\|raw` | `GameState` / `PlayerVisibleState` JSON | Snapshot for `script` verifiers + golden diffing. |
| `force-end` | `{ gameId, winner }` | `{ ended }` | **Already exists.** Keep as-is. |

### Named scenarios (the seedable surface)

Each scenario is a pure `(state, ctx) => GameState` transform applied right after
`createGame`. Start with the states our specs actually need:

| Scenario | What it sets up | Unlocks testing |
| --- | --- | --- |
| `fresh` | tick 0, everyone at fountain, default gold | spawn / first-tick UI |
| `laning` | ~tick 30, players in lanes, a creep wave, some last-hit gold | combat log, zone panel, last-hit, map presence |
| `teamfight` | several heroes co-located mid, low HP, cooldowns mixed | kill feed, salience tiers, damage flash, threat sheet |
| `roshan_up` / `roshan_dead` | Roshan alive / dead with `deathTick` set | objective ticker Roshan timer, aegis-in-pit |
| `rune_live` | a power rune present at `rune-top` | rune readout |
| `core_vulnerable` | a T3 down so an Ancient is `vulnerable` | macro-strip Core urgency, win-condition proximity |
| `self_dead` | the **human** player `alive: false, hp: 0, respawnTick: tick+30` | death overlay ("PROCESS TERMINATED" / "Respawning in"); seed with `manualTick: true` so the respawn handler never revives them. Needs `humanId` → `applyScenario(state, scenario, { humanId })`. |
| `can_buyback` | self dead, gold ≥ buyback cost, cooldown ready | death overlay + buyback |
| `ahead` / `behind` | net-worth gap seeded both ways | War Room net-worth lead + sparkline |
| `night` | `timeOfDay: night` | day/night readout + vision meaning |

> **Implemented today** (`KNOWN_SCENARIOS` in `server/game/dev/scenarios.ts`):
> `fresh`, `laning`, `roshan_dead`, `core_vulnerable`, `night`, `self_dead`. The
> rest of the table is the planned surface; add each as a spec needs it (each is a
> pure, unit-tested transform).

Scenarios compose with `patch` for fine tweaks (e.g. `roshan_dead` + patch
self gold). They live in one file (`server/game/dev/scenarios.ts`, dev-only) so
the catalog is greppable and unit-testable in isolation.

## Reference implementation (Phase A — ready to paste)

The creation logic currently lives inline in the `matchmaking:game_ready`
handler (`game-server.ts:440-516`). Extract it into an exported helper both the
handler and the hook call — no behavior change to the live path:

```ts
// server/plugins/game-server.ts (new export; uses the same closures as the handler)
export async function createDevGame(opts: {
  humanId: string
  humanHeroId?: string
  seed?: number
  fastGame?: number
  scenario?: string
}): Promise<{ gameId: string } | null> {
  if (process.env.NODE_ENV === 'production') return null
  const runtime = _runtime
  if (!runtime) return null

  const gameId = `dev_${opts.seed ?? Date.now()}_${(opts.seed ?? 0).toString(36)}`
  const players = buildDevRoster(opts.humanId, opts.humanHeroId) // 1 human + 9 bots, fixed teams/heroes
  const stateManager = createInMemoryStateManager()
  registerLiveGame(gameId, stateManager)

  await runtime.managedRuntime.runPromise(
    Effect.gen(function* () {
      yield* stateManager.createGame(gameId, players)         // PlayerSetup[] = {id,name,team,heroId}
      yield* stateManager.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const }))
      // Deterministic scenario transform (pure), applied to the real state:
      if (opts.scenario) yield* stateManager.updateState(gameId, (s) => applyScenario(s, opts.scenario!, opts.seed))
    }),
  )
  registerBots(gameId, players.filter((p) => isBot(p.id)).map((p) => ({ playerId: p.id, team: p.team, heroId: p.heroId })))
  setPlayerGame(opts.humanId, gameId)
  startGameLoop(gameId, stateManager, buildCallbacks(players, stateManager), runtime.managedRuntime, runtime.redisService, { players })
  return { gameId }
}
```

```ts
// server/api/test/login-as.post.ts
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production' || process.env.TERMINA_TEST_HOOKS !== '1')
    throw createError({ statusCode: 404, message: 'Not found' })
  const { username } = await readBody(event)
  // 3-40 chars (widened from 20) so the v1.9 per-run identity cairn_${run.token}
  // (~21 chars) fits — see "Per-run identity" below.
  if (typeof username !== 'string' || !/^\w{3,40}$/.test(username))
    throw createError({ statusCode: 400, message: 'username 3-40 [A-Za-z0-9_]' })
  const player = await ensureDevPlayer(username) // find-or-create in DB; id like `local_<username>`
  await setUserSession(event, {
    user: { id: player.id, username, avatarUrl: player.avatarUrl, selectedAvatar: player.selectedAvatar, provider: 'local', hasPassword: false },
  })
  return { playerId: player.id }
})
```

```ts
// server/api/test/new-game.post.ts
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production' || process.env.TERMINA_TEST_HOOKS !== '1')
    throw createError({ statusCode: 404, message: 'Not found' })
  const session = await requireUserSession(event)           // login-as ran first
  const humanId = session.user.id as string
  const { scenario, heroSelf, seed, fastGame } = await readBody(event)
  const created = await createDevGame({ humanId, humanHeroId: heroSelf, scenario, seed, fastGame })
  if (!created) throw createError({ statusCode: 409, message: 'could not create dev game' })
  return { gameId: created.gameId, playerId: humanId, url: `/play?gameId=${created.gameId}&dev=1` }
})
```

### Client entry (one small, dev-gated change)

After matchmaking, the client learns `gameId`/`playerId` from the lobby WS and
the Pinia store; a seeded game has no lobby. Two clean options:

- **Preferred:** `app/pages/play.vue` reads `?gameId=` (and uses the session
  user as `playerId`) when present, seeding `gameStore.gameId`/`playerId`
  before connecting. Harmless in prod (no hook produces the param, and the WS
  `ws-ticket` still authorizes the socket), so it needs no separate gate.
- Alternative: a dev-only Nuxt plugin that calls `/api/test/state` to resolve
  the active game for the session.

The `new-game` response already returns `url: /play?gameId=…`, so a cairntrace
`open: ${requests.game.body.url}` lands the browser straight in the live game.

### `advance` + the GameLoop

`startGameLoop` runs `processTick` on a 4s timer. For deterministic stepping,
`GameLoop` gains a dev-only `stepTicks(gameId, n)` that calls the same
`processTick` synchronously n times (guarded by `TERMINA_TEST_HOOKS`). The
`advance` route calls it. This replaces "wait wall-clock" with "advance exactly
N ticks", and pairs with `fastGame` for when you do want the timer running.

## Phase B — seedable RNG (full replicability)

To make an entire match (bot decisions, crits, neutral spawns) byte-identical
across runs, replace ad-hoc `Math.random()` with a per-game seeded PRNG:

1. Add `rngState` (or a `seed`) to `GameState`; initialize from `createDevGame`'s
   `seed` (real games seed from `Date.now()` as today).
2. Provide `nextRandom(state)` (e.g. mulberry32 / xorshift) and thread it through
   the engine, OR keep a `Map<gameId, () => number>` rng registry the systems
   read. Replace the ~9 `Math.random()` call sites (grep them; they're listed
   above) with the seeded source.
3. Now `seed: 1337` ⇒ the same crit rolls, the same neutral camps, the same bot
   choices — every run. `cairn diff` between two runs of the same seed should be
   empty; a non-empty diff is a real regression.

Phase B is optional for screen/scenario coverage but is the unlock for
"replay this exact match" and for flaky-free assertions on RNG-driven outcomes.

## Per-run identity (cairntrace v1.9)

`testUser` is set once in `cairntrace.config.yml` to `cairn_${run.token}` — a
v1.9 runtime placeholder that expands to a **unique token per run** (and per
parallel worker). Because Termina broadcasts state per user-id over the WS, two
flows sharing a user would let one game loop clobber the other's seeded state;
per-run identity removes that race **without hand-assigning a username to each
flow**. Flows therefore do not set `testUser` themselves — they inherit it, and
`actions/login.yml` mints `cairn_<token>` via `login-as`. (This is why the hook's
username limit was widened to 40 chars.) When a flow needs a *second* distinct
identity — e.g. a non-participant spectator — it logs in again with a different
token-derived name (`spec_${run.token}`); see `flows/game_spectator.yml`.

A known v1.9 limitation: `${run.token}`/`${requests.*}`/`${vars.*}` substitution
applies in **steps** but **not** inside `script.run` bodies or outcome `verify`
blocks. Inside a script, read identifiers from `window.location.search`; for an
outcome, pin `seed: 1337` so the gameId is deterministic and match it by regex.

## How cairntrace drives the harness

Two integration styles; prefer `request` (in-session, captured, spliced):

```yaml
# actions/new_game.yml — login + seed, used as a cold-start setup
version: 1
name: new_game
steps:
  - id: login
    request: { method: POST, url: /api/test/login-as, body: { username: "${vars.testUser}" }, expectStatus: 200 }
  - id: seed
    request:
      method: POST
      url: /api/test/new-game
      body: { scenario: "${vars.scenario}", heroSelf: "${vars.heroSelf}", seed: 1337 }
      expectStatus: 200
      assign: game
  - id: enter
    open: { path: "${requests.game.body.url}", waitUntil: networkidle }
```

```yaml
# inside a flow: advance ticks, then assert
steps:
  - use: new_game
  - request: { method: POST, url: /api/test/advance, body: { gameId: "${requests.game.body.gameId}", ticks: 5 } }
outcomes:
  - id: kill_feed_shows_first_blood
    verify: { text: { contains: "FIRST BLOOD" } }
  - id: engine_agrees           # cross-check the DOM against engine truth
    verify:
      httpJson:
        url: "/api/test/state?gameId=${requests.game.body.gameId}"
        jsonPath: "$.roshan.alive"
        equals: false
```

`preconditions.commands` is the alternative when setup is better as a script
(e.g. flushing the test Redis between runs, per the e2e gotchas memo):

```yaml
preconditions:
  commands:
    - name: flush_test_redis
      run: redis-cli -n 1 FLUSHDB
```

## Saving assets + verifying results

Cairntrace already writes a self-contained pack per run under
`tests/e2e/runs/<run-id>/` (config `artifactRoot`): `run.md`,
`agent_context.md`, `snapshots/`, `screenshots/`, `console/`, `network/`,
`requests/` (the seed/advance responses), `diagnostics/` (on failure). For
Termina specifically:

- **DOM/visual evidence:** `snapshot: { interactive: true, label: "..." }` steps
  capture the in-game screen at key beats (post-seed, post-advance). Screenshots
  on failure by default; flip to `always` per spec when you want a visual record.
- **Engine-truth evidence:** a `script` verifier that fetches `/api/test/state`
  and asserts the field (e.g. `roshan.alive === false`) writes its `{ ok,
  evidence }` to `outcomes/<id>.md` (+ `.raw.json` sidecar). That JSON snapshot
  *is* the golden artifact.
- **Golden/regression:** `cairn diff <runA> <runB>` structurally compares two
  runs (outcomes/steps/console/network). Run a seeded scenario, save the run id,
  and diff future runs against it. With Phase B seeded RNG this becomes exact.
- **Retention:** `retention.keepRuns: 20` (config) prunes automatically;
  `cairn clean --all` to wipe.

## Phased implementation plan

- **A1 (foundation):** `login-as` + `createDevGame` export + `new-game` +
  play.vue `?gameId` entry. Prove `actions/new_game.yml` + one flow green with
  `cairn run --cold-start`. *This alone removes matchmaking from every game spec.*
- **A2 (scenarios):** `server/game/dev/scenarios.ts` catalog + `scenario` route +
  `patch`. Unit-test each scenario transform (pure fn) in `tests/unit`.
- **A3 (stepping + snapshot):** `GameLoop.stepTicks` + `advance` route +
  `state` route + a `assert-state` node verifier helper.
- **B (replicability):** seeded PRNG across the engine; `cairn diff` becomes an
  exact regression gate on seeded runs.

Each Ax is independently shippable and immediately useful. A1 is the one that
pays for the whole migration.

## Safety checklist (every hook)

- Double gate: `NODE_ENV !== 'production' && TERMINA_TEST_HOOKS === '1'` at the
  route AND a `process.env.NODE_ENV === 'production'` hard-return in any exported
  helper (mirror `forceEndGame`).
- No secrets/tokens in responses or artifacts (cairntrace redaction + the
  AGENTS.md rule already cover this; keep `state` to game data only).
- `login-as` only mints `provider: 'local'` dev users; never elevates a real
  account.
- Routes are invisible (404) without the opt-in, so they can't be probed in a
  normal dev session that didn't set `TERMINA_TEST_HOOKS=1`.
