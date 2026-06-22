/**
 * TERMINA_TEST_FAST_GAME — dev/test-only game accelerator.
 *
 * Real bot games end via Ancient destruction, which takes 35-50 minutes of
 * wall-clock time at the production 4s tick. That makes "play a game to the
 * end" e2e specs (game-over, smoke) impossible to run honestly. Setting
 * TERMINA_TEST_FAST_GAME=<factor> (e.g. 8) on the server process:
 *
 *   - runs the game loop at TICK_DURATION_MS / factor (engine logic is
 *     tick-based and deterministic, so nothing else changes),
 *   - divides Ancient HP by the factor, and
 *   - halves tower HP when the factor is >= 4,
 *
 * so a full bot game ends in ~2-4 minutes of real time. The hook is ignored
 * in production builds (NODE_ENV === 'production') and when the var is
 * unset, so production pacing is untouched.
 *
 * Used by: any dev/test server started for e2e runs (set TERMINA_TEST_FAST_GAME
 * in the server env alongside TERMINA_TEST_HOOKS=1 — see README.md (Testing)).
 */
import { isRealProduction } from '~~/server/utils/testHooks'

const MAX_FACTOR = 16

export function fastGameFactor(): number {
  if (isRealProduction()) return 1
  const raw = process.env.TERMINA_TEST_FAST_GAME
  if (!raw) return 1
  const factor = Number.parseFloat(raw)
  if (!Number.isFinite(factor) || factor <= 1) return 1
  return Math.min(factor, MAX_FACTOR)
}

/** Effective wall-clock tick interval for the game loop. */
export function scaledTickIntervalMs(baseMs: number): number {
  return Math.max(100, Math.round(baseMs / fastGameFactor()))
}

/** Effective Ancient max HP. */
export function scaledAncientHp(baseHp: number): number {
  return Math.max(1, Math.ceil(baseHp / fastGameFactor()))
}

/**
 * Effective tower max HP. Towers gate the whole game — the enemy Ancient only
 * becomes vulnerable once a T3 falls, so slow sieging drags games out. In
 * dev/test the loop is CPU-bound (~1s/tick, not the nominal interval), so the
 * old flat /2 left games running 400-900 ticks (15-20 real minutes). We shrink
 * towers harder, but cap the divisor at 4 so games don't end TOO fast: at /8
 * a stomp finished by tick ~74, which can end a mid-game test before it has
 * finished interacting. /4 targets a ~120-220 tick window that suits both the
 * play-to-the-end specs (game-over, smoke) and the mid-game specs.
 */
export function scaledTowerHp(baseHp: number): number {
  return Math.max(1, Math.ceil(baseHp / Math.min(fastGameFactor(), 4)))
}

/**
 * Effective respawn duration in ticks. Multiplied by the factor so the
 * wall-clock respawn time matches production — without this, a death at
 * factor 8 would respawn in ~1.5s real time, far too fast for a human (or a
 * death-overlay e2e assertion) to even see.
 */
export function scaledRespawnTicks(baseTicks: number): number {
  return baseTicks * fastGameFactor()
}
