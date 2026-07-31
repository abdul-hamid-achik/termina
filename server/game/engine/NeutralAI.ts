import type { GameState, SiltDwellerState } from '~~/shared/types/game'
import {
  SILT_DWELLERS,
  SILT_DWELLER_INTERVAL_CYCLES,
  MAX_NEUTRALS_PER_CAMP,
  type SiltDwellerType,
} from '~~/shared/constants/balance'
import { resolveKineticHit } from './CombatResolver'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

let neutralIdCounter = 0
let gameInstanceSuffix = ''

function nextNeutralId(): string {
  return `neutral_${gameInstanceSuffix}_${++neutralIdCounter}`
}

export function resetNeutralIdCounter(gameId?: string): void {
  neutralIdCounter = 0
  gameInstanceSuffix = gameId
    ? gameId.replace(/-/g, '_').slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
}

/** Jungle camp zones */
const JUNGLE_ZONES = [
  'silt-chaff-top',
  'silt-chaff-bot',
  'silt-audit-top',
  'silt-audit-bot',
] as const

/** Spawn neutral waves in silt camps. `hasZone` skips camps a subset map
 *  doesn't have (one-lane has no silt). `existingNeutrals` is used to enforce
 *  MAX_NEUTRALS_PER_CAMP — camps at cap are skipped (no new spawns). */
export function spawnSiltDwellers(
  cycle: number,
  hasZone?: (zoneId: string) => boolean,
  existingNeutrals: SiltDwellerState[] = [],
): SiltDwellerState[] {
  // Spawn at cycle 60, then every 60 ticks
  if (cycle === 0 || cycle % SILT_DWELLER_INTERVAL_CYCLES !== 0) return []

  // Count live neutrals per zone to enforce the cap
  const liveCountByZone = new Map<string, number>()
  for (const n of existingNeutrals) {
    if (n.alive) liveCountByZone.set(n.zone, (liveCountByZone.get(n.zone) ?? 0) + 1)
  }

  const neutrals: SiltDwellerState[] = []

  for (const zone of JUNGLE_ZONES) {
    if (hasZone && !hasZone(zone)) continue
    // Skip camps already at cap — prevents unbounded accumulation
    const currentCount = liveCountByZone.get(zone) ?? 0
    if (currentCount >= MAX_NEUTRALS_PER_CAMP) continue

    // Each camp gets 1-2 random neutrals, but respect the cap
    const campSize = Math.min(Math.random() < 0.5 ? 1 : 2, MAX_NEUTRALS_PER_CAMP - currentCount)
    if (campSize <= 0) continue

    for (let i = 0; i < campSize; i++) {
      // Random wave type (weighted towards smaller ones)
      const roll = Math.random()
      let waveType: SiltDwellerType

      if (roll < 0.4) {
        waveType = 'stub'
      } else if (roll < 0.7) {
        waveType = 'watchdog'
      } else if (roll < 0.9) {
        waveType = 'warden'
      } else if (roll < 0.95) {
        waveType = 'orphan'
      } else {
        waveType = 'zombie'
      }

      const stats = SILT_DWELLERS[waveType]!

      neutrals.push({
        id: nextNeutralId(),
        zone,
        integ: stats.integ,
        maxInteg: stats.integ,
        type: waveType,
        alive: true,
      })
    }
  }

  return neutrals
}

export interface NeutralAction {
  neutralId: string
  targetId: string // player ID
  damage: number
}

/**
 * Neutral waves defend themselves - attack enemies in their zone
 */
export function runNeutralAI(state: GameState): NeutralAction[] {
  const actions: NeutralAction[] = []

  for (const neutral of state.neutrals ?? []) {
    if (!neutral.alive) continue

    // Find enemies in the same zone
    const enemies = Object.values(state.players).filter(
      (p) => p && p.zone === neutral.zone && p.alive,
    )

    if (enemies.length > 0) {
      // Attack a random enemy in range (always adjacent for neutrals)
      const target = enemies[Math.floor(Math.random() * enemies.length)]!
      const stats = SILT_DWELLERS[neutral.type as SiltDwellerType]
      if (stats) {
        actions.push({
          neutralId: neutral.id,
          targetId: target.id,
          damage: stats.attack,
        })
      }
    }
  }

  return actions
}

/**
 * Apply neutral wave attacks to players. Returns updated state plus a damage
 * event per landed hit — jungling was previously silent, so a camp could chew
 * a hero down with no log line, float or kill attribution.
 */
export function applyNeutralActions(
  state: GameState,
  actions: NeutralAction[],
): { state: GameState; events: GameEngineEvent[] } {
  const players = { ...state.players }
  const events: GameEngineEvent[] = []

  for (const action of actions) {
    const neutral = (state.neutrals ?? []).find((n) => n.id === action.neutralId)
    if (!neutral || !neutral.alive) continue

    const target = players[action.targetId]
    if (!target || !target.alive) continue

    // Route through resolveKineticHit for the full mitigation chain — same as
    // ice, waves, and Tenant. Previously this did raw `hp - damage` with only
    // an immunity check, bypassing armor items, shields, hardened reduction,
    // vulnerability amplifiers, and phase shift dodge.
    const hit = resolveKineticHit(target, action.damage)
    if (hit.immune || hit.dodged) continue

    // Persist the mitigated hero BEFORE deciding whether to narrate it. A hit a
    // shield fully absorbs deals 0 INTEG damage but still SPENDS shield stacks, and
    // dealDamage returns them already decremented — dropping the write here
    // meant a shielded hero could stand in a camp forever, because the shield
    // could never be worn down.
    players[action.targetId] = hit.player

    // A fully-absorbed hit must not reach the event stream — a `0` damage float
    // reads as a bug to the player.
    if (hit.damageDealt === 0) continue

    events.push({
      _tag: 'damage',
      cycle: state.cycle,
      sourceId: action.neutralId,
      targetId: action.targetId,
      amount: hit.damageDealt,
      damageType: 'kinetic',
    })
  }

  return { state: { ...state, players }, events }
}

/**
 * Handle neutral wave deaths from hero attacks
 */
// (Removed `handleNeutralDeaths` — it was never called: it hardcoded an empty
// playerId and the real neutral-kill bounty is awarded inline in
// ActionResolver's neutral-attack path.)
