import { Effect } from 'effect'
import type { GameMode, GameState, PlayerState } from '~~/shared/types/game'
import type { Command, TargetRef } from '~~/shared/types/commands'
import type { HeroId } from '~~/shared/types/hero'
import type { TalentTier } from '~~/shared/constants/talents'
import {
  createInMemoryStateManager,
  type PlayerSetup,
  type StateManagerApi,
} from '~~/server/game/engine/StateManager'
import { processTick, submitAction } from '~~/server/game/engine/GameLoop'
import { applyScenario, type KNOWN_SCENARIOS } from '~~/server/game/dev/scenarios'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

/**
 * In-process gameplay harness — the fast, deterministic home for "does this game
 * SITUATION resolve correctly" tests. It drives the REAL engine
 * (`createInMemoryStateManager` + `submitAction` + `processTick`) with ZERO infra:
 * no browser, no server, no Postgres, no Redis. It is the same pipeline
 * `scripts/simulate-game.ts` and `tests/integration/game-flow.test.ts` use, with
 * the seed → act → advance → assert ceremony factored into one ergonomic API.
 *
 * It shares its scenario catalog (`server/game/dev/scenarios.ts::applyScenario`)
 * with the Cairntrace `/api/test/new-game` hook, so a scenario means the same
 * thing in-process here and in the browser e2e. Use this for engine truth; keep
 * Cairntrace for "the UI renders + a human can click it".
 *
 * Determinism note: the engine has no injectable RNG (bot AI uses Math.random),
 * so the harness never registers bots — only the human + a single enemy exist,
 * and nothing acts unless you `submit` it.
 *
 * Assertion gotchas (hard-won — read before writing HP / cast / buff checks):
 *  - First-tick maxHp recompute. Heroes seed at level 6 and their maxHp is
 *    recomputed on the FIRST tick, INFLATING hp. A raw `hp` delta across that
 *    first tick is therefore confounded — either `tick()` ONCE up front to settle
 *    it, or assert on a regen/recompute-independent signal (a `damage` event, a
 *    buff's `stacks`, a cooldown, or the maxHp cap) instead of raw hp.
 *  - Never set `mp` above `maxMp` to "guarantee" a cast — it silently breaks the
 *    cast (no resolution, no events, no cooldown). The seed already carries enough
 *    mana; just zero the cooldowns (`cooldowns: { q:0,w:0,e:0,r:0 }`) and cast.
 *  - A 1-tick disable (most stuns are duration 1) is gone by the time you assert:
 *    it's applied during cast resolution, then `tickAllBuffs` decrements + reaps
 *    it later in the SAME tick. To observe an applied debuff use a multi-tick one
 *    (a DoT, a longer slow) or assert its enforcement effect, not buff presence.
 *  - Per-tick regen is small but nonzero. For "took damage" prefer the damage
 *    event; for "was safe/healed" assert `hp >= before` (regen only ever adds).
 */

export type KnownScenario = (typeof KNOWN_SCENARIOS)[number]

/** Stable ids for the two seeded heroes, so tests read like prose. */
export const HUMAN = 'human'
export const ENEMY = 'enemy'

export interface SeedOptions {
  /** The human's hero (default 'echo' — matches the e2e flows this replaces). */
  heroSelf?: HeroId
  /** The enemy's hero for scenarios that co-locate an opponent (default 'daemon'). */
  heroEnemy?: HeroId
  /** Deterministic seed forwarded to `applyScenario`. */
  seed?: number
  /** Full player roster override (for team-sized scenarios). Replaces human+enemy. */
  players?: PlayerSetup[]
  /** Which map to seed (see shared/constants/maps). Default = full 5v5. */
  mapId?: string
  /** Game mode to seed. Default = 'normal'; 'tutorial' for the guided flow. */
  mode?: GameMode
}

// Unique gameId per scenario so module-level engine state keyed by gameId
// (action queues, assist tracking) never bleeds between tests.
let seq = 0

/**
 * Seed a fresh `playing` game, shaped by a named scenario, and return a {@link Run}
 * you can drive. By default it spawns one human (radiant) + one enemy (dire).
 */
export async function seedGame(scenario: KnownScenario, opts: SeedOptions = {}): Promise<Run> {
  const setup: PlayerSetup[] = opts.players ?? [
    { id: HUMAN, name: HUMAN, team: 'radiant', heroId: opts.heroSelf ?? 'echo' },
    { id: ENEMY, name: ENEMY, team: 'dire', heroId: opts.heroEnemy ?? 'daemon' },
  ]
  const gameId = `gp_${scenario}_${seq++}`
  const sm = createInMemoryStateManager()
  await Effect.runPromise(sm.createGame(gameId, setup, { mapId: opts.mapId, mode: opts.mode }))
  await Effect.runPromise(
    sm.updateState(gameId, (s) =>
      applyScenario({ ...s, phase: 'playing' as const }, scenario, {
        humanId: HUMAN,
        seed: opts.seed,
      }),
    ),
  )
  return new Run(sm, gameId)
}

/** A seeded game you can drive one tick at a time and read engine truth from. */
export class Run {
  /** Events emitted by the most recent `tick()`. */
  lastEvents: GameEngineEvent[] = []
  /** Every event emitted across the run, in order. */
  readonly allEvents: GameEngineEvent[] = []
  /** Player-action rejections from the most recent `tick()` (the feedback the
   *  real game pushes via onActionRejected). */
  lastRejected: Array<{ playerId: string; reason: string }> = []

  constructor(
    private readonly sm: StateManagerApi,
    readonly gameId: string,
    /** The player most command sugar targets by default. */
    readonly playerId: string = HUMAN,
  ) {}

  // --- queue actions (sync, like the real submitAction) -------------------

  /** Queue a raw {@link Command} for a player (defaults to the human). */
  submit(command: Command, as: string = this.playerId): this {
    submitAction(this.gameId, as, command)
    return this
  }
  cast(ability: 'q' | 'w' | 'e' | 'r', target?: TargetRef, as?: string): this {
    return this.submit(target ? { type: 'cast', ability, target } : { type: 'cast', ability }, as)
  }
  attackHero(name: string, as?: string): this {
    return this.submit({ type: 'attack', target: { kind: 'hero', name } }, as)
  }
  buy(item: string, as?: string): this {
    return this.submit({ type: 'buy', item }, as)
  }
  selectTalent(tier: TalentTier, talentId: string, as?: string): this {
    return this.submit({ type: 'select_talent', tier, talentId }, as)
  }

  // --- advance + read -----------------------------------------------------

  /** Advance N engine ticks, persisting each, mirroring the real game loop. */
  async tick(n = 1): Promise<this> {
    for (let i = 0; i < n; i++) {
      const state = await Effect.runPromise(this.sm.getState(this.gameId))
      const result = await Effect.runPromise(processTick(this.gameId, state))
      await Effect.runPromise(this.sm.updateState(this.gameId, () => result.state))
      this.lastEvents = result.events
      this.allEvents.push(...result.events)
      this.lastRejected = result.rejectedActions
    }
    return this
  }

  /** The full current engine state. */
  state(): Promise<GameState> {
    return Effect.runPromise(this.sm.getState(this.gameId))
  }

  /** One player's engine state (defaults to the human). Throws if absent. */
  async player(id: string = this.playerId): Promise<PlayerState> {
    const s = await this.state()
    const p = s.players[id]
    if (!p) throw new Error(`No such player in game ${this.gameId}: ${id}`)
    return p
  }

  /** The human player's engine state. */
  me(): Promise<PlayerState> {
    return this.player(this.playerId)
  }

  /** Arrange-style escape hatch: patch raw state before/between ticks. */
  async patch(fn: (s: GameState) => GameState): Promise<this> {
    await Effect.runPromise(this.sm.updateState(this.gameId, fn))
    return this
  }
}
