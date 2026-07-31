import type { WaveUnitState, GameState, TeamId, IceState, PlayerState } from '~~/shared/types/game'
import {
  waveUnitAttack,
  WAVE_BASE_IDLE_DESPAWN_CYCLES,
  WAVE_XP_SHARED,
  MAX_WAVE_UNITS_PER_ZONE_PER_TEAM,
} from '~~/shared/constants/balance'
import { resolveKineticHit } from './CombatResolver'
import { awardZoneXp } from './XpDistributor'
import { resolveTerminalAttack } from './TerminalSystem'
import { LANE_ROUTES_CORE } from '~~/shared/constants/lanes'
import type { GameEngineEvent } from '~~/server/game/protocol/events'

/** The enemy base zone for a wave team — the end of every lane route. */
const ENEMY_BASE: Record<TeamId, string> = {
  chaff: 'audit-base',
  audit: 'chaff-base',
}

/** Lane routes: ordered zone sequences from each base toward the enemy base. */
const LANE_ROUTES = LANE_ROUTES_CORE

/** Determine which lane a wave is on based on its zone. */
function getWaveLane(zone: string): string | null {
  if (zone === 'chaff-base' || zone === 'audit-base' || zone.includes('fountain')) return null
  if (zone.startsWith('top-')) return 'top'
  if (zone.startsWith('mid-')) return 'mid'
  if (zone.startsWith('bot-')) return 'bot'
  return null
}

/** Get the next zone for a wave along its lane route. */
function getNextZone(wave: WaveUnitState): string | null {
  const lane = getWaveLane(wave.zone)
  if (!lane) return null

  const route = LANE_ROUTES[lane]?.[wave.team]
  if (!route) return null

  const currentIndex = route.indexOf(wave.zone)
  if (currentIndex === -1 || currentIndex >= route.length - 1) return null

  return route[currentIndex + 1]!
}

/** Find enemy waves in the same zone. */
function getEnemyWavesInZone(waves: WaveUnitState[], wave: WaveUnitState): WaveUnitState[] {
  return waves.filter((c) => c.zone === wave.zone && c.team !== wave.team && c.integ > 0)
}

/** Find enemy heroes in the same zone. */
function getEnemyHeroesInZone(
  players: Record<string, PlayerState>,
  zone: string,
  team: WaveUnitState['team'],
): PlayerState[] {
  return Object.values(players).filter((p) => p.zone === zone && p.team !== team && p.alive)
}

/** Find enemy ice in the same zone. */
function getEnemyIceInZone(
  ice: IceState[],
  zone: string,
  team: WaveUnitState['team'],
): IceState | undefined {
  return ice.find((t) => t.zone === zone && t.team !== team && t.alive)
}

export interface WaveAction {
  waveId: string
  action:
    | 'move'
    | 'attack_wave'
    | 'attack_hero'
    | 'attack_ice'
    | 'attack_terminal'
    | 'wait_in_base'
    | 'despawn'
  targetId?: string
  targetZone?: string
  damage?: number
}

/**
 * Run wave AI for all waves. Returns a list of actions to apply.
 *
 * Wave behavior:
 * - If enemy waves in same zone: attack
 * - In the enemy base with a vulnerable Terminal: breach the Terminal
 *   (above heroes — the wave commits to the objective, which also keeps
 *   base waves from grinding down every respawning hero)
 * - If enemy heroes in same zone: attack
 * - If enemy ice in zone: attack ice
 * - Otherwise: move toward enemy base along lane (1 zone per cycle)
 * - Stuck in the enemy base with an invulnerable Terminal and nothing to
 *   attack: idle, then get garbage collected after
 *   WAVE_BASE_IDLE_DESPAWN_CYCLES idle ticks
 */
export function runWaveAI(state: GameState): WaveAction[] {
  const actions: WaveAction[] = []

  for (const wave of state.waves) {
    if (wave.integ <= 0) continue

    // Damage escalates with the CURRENT tick, not the wave's spawn wave:
    // WaveUnitState carries no per-wave stats, and a whole board that gets
    // stronger together is also the readable rule for the player.
    const damage = waveUnitAttack(wave.type, state.cycle)
    const inEnemyBase = wave.zone === ENEMY_BASE[wave.team]
    const enemyTerminal = wave.team === 'chaff' ? state.terminals?.audit : state.terminals?.chaff

    // Priority 1: attack enemy waves in same zone
    const enemyWaves = getEnemyWavesInZone(state.waves, wave)
    if (enemyWaves.length > 0) {
      actions.push({
        waveId: wave.id,
        action: 'attack_wave',
        targetId: enemyWaves[0]!.id,
        damage,
      })
      continue
    }

    // Priority 2 (enemy base only): breach the Terminal when it's vulnerable
    if (inEnemyBase && enemyTerminal && enemyTerminal.alive && enemyTerminal.vulnerable) {
      actions.push({
        waveId: wave.id,
        action: 'attack_terminal',
        damage,
      })
      continue
    }

    // Priority 3: attack enemy heroes in same zone
    const enemyHeroes = getEnemyHeroesInZone(state.players, wave.zone, wave.team)
    if (enemyHeroes.length > 0) {
      actions.push({
        waveId: wave.id,
        action: 'attack_hero',
        targetId: enemyHeroes[0]!.id,
        damage,
      })
      continue
    }

    // Priority 4: attack enemy ice in same zone
    const enemyIce = getEnemyIceInZone(state.ice, wave.zone, wave.team)
    if (enemyIce) {
      actions.push({
        waveId: wave.id,
        action: 'attack_ice',
        targetZone: enemyIce.zone,
        damage,
      })
      continue
    }

    // Priority 5: move forward along lane
    const nextZone = getNextZone(wave)
    if (nextZone) {
      actions.push({
        waveId: wave.id,
        action: 'move',
        targetZone: nextZone,
      })
      continue
    }

    // No move possible — wave is parked in a base zone with nothing to do.
    // Idle for a few ticks, then despawn ("garbage collected") so waves
    // never pile up unboundedly in base.
    if (wave.zone === ENEMY_BASE[wave.team] || wave.zone === ENEMY_BASE[enemyTeam(wave.team)]) {
      if ((wave.baseIdleCycles ?? 0) + 1 >= WAVE_BASE_IDLE_DESPAWN_CYCLES) {
        actions.push({ waveId: wave.id, action: 'despawn' })
      } else {
        actions.push({ waveId: wave.id, action: 'wait_in_base' })
      }
    }
  }

  return actions
}

function enemyTeam(team: TeamId): TeamId {
  return team === 'chaff' ? 'audit' : 'chaff'
}

/**
 * Apply wave actions to the game state. Returns updated state plus any
 * events to emit (hero damage, Terminal damage / destruction).
 */
export function applyWaveActions(
  state: GameState,
  actions: WaveAction[],
): { state: GameState; events: GameEngineEvent[] } {
  let waves = state.waves.map((c) => ({ ...c }))
  let ice = state.ice.map((t) => ({ ...t }))
  let players = { ...state.players }
  let terminals = state.terminals
  const events: GameEngineEvent[] = []

  for (const action of actions) {
    const wave = waves.find((c) => c.id === action.waveId)
    if (!wave || wave.integ <= 0) continue

    switch (action.action) {
      case 'move': {
        if (action.targetZone) {
          waves = waves.map((c) =>
            c.id === action.waveId ? { ...c, zone: action.targetZone! } : c,
          )
        }
        break
      }
      case 'attack_wave': {
        const target = waves.find((c) => c.id === action.targetId)
        if (target && target.integ > 0) {
          const newInteg = Math.max(0, target.integ - (action.damage ?? 0))
          waves = waves.map((c) => (c.id === action.targetId ? { ...c, integ: newInteg } : c))
          if (newInteg === 0) {
            // Waves kill each other far more often than heroes kill them
            // (priority 1 above focuses enemy waves), so this is where the
            // MAJORITY of wave XP enters the game. Without it a laner who
            // never last-hits earns nothing at all from a wave they stood in.
            // The killing wave's team is by construction the dying wave's
            // enemy — getEnemyWavesInZone only ever targets across teams.
            players = awardZoneXp(players, target.zone, wave.team, WAVE_XP_SHARED)
          }
        }
        break
      }
      case 'attack_hero': {
        if (action.targetId && players[action.targetId] && players[action.targetId]!.alive) {
          // Route through the shared mitigation chain so wave hits honor item
          // plate, vuln amps, Kernel 'hardened', shields, and Echo phaseShift
          // — previously waves used raw target.plate and skipped the
          // multiplier, hardened, shield, and dodge.
          const hit = resolveKineticHit(players[action.targetId]!, action.damage ?? 0)
          if (hit.immune || hit.damageDealt === 0) break
          players = {
            ...players,
            [action.targetId]: hit.player,
          }
          events.push({
            _tag: 'damage',
            cycle: state.cycle,
            sourceId: wave.id,
            targetId: action.targetId,
            amount: hit.damageDealt,
            damageType: 'kinetic',
          })
        }
        break
      }
      case 'attack_ice': {
        const iceIdx = ice.findIndex((t) => t.zone === action.targetZone && t.alive)
        if (iceIdx >= 0) {
          const target = ice[iceIdx]!
          // Harden invulnerability blocks the wave wave too, not just heroes —
          // otherwise a glyphed ice still gets chewed down by the push. Hero
          // attacks already bounce off (ActionResolver), so mirror that here.
          if (!target.invulnerable) {
            const newInteg = Math.max(0, target.integ - (action.damage ?? 0))
            ice = ice.map((t, i) =>
              i === iceIdx ? { ...t, integ: newInteg, alive: newInteg > 0 } : t,
            )
          }
        }
        break
      }
      case 'attack_terminal': {
        // Route through the shared helper so wave and hero attacks follow
        // identical vulnerability/destruction rules.
        const result = resolveTerminalAttack(
          { ...state, waves, terminals },
          action.waveId,
          action.damage ?? 0,
        )
        terminals = result.state.terminals
        events.push(...result.events)
        break
      }
      case 'wait_in_base': {
        waves = waves.map((c) =>
          c.id === action.waveId ? { ...c, baseIdleCycles: (c.baseIdleCycles ?? 0) + 1 } : c,
        )
        break
      }
      case 'despawn': {
        waves = waves.filter((c) => c.id !== action.waveId)
        break
      }
    }
  }

  // Remove dead waves
  waves = waves.filter((c) => c.integ > 0)

  return { state: { ...state, waves, ice, players, terminals }, events }
}

/**
 * Defensive guard: cap lane waves at MAX_WAVE_UNITS_PER_ZONE_PER_TEAM per team
 * per zone, despawning the oldest first (waves are appended in spawn order,
 * so earliest in the array = oldest). Returns the same object when no zone
 * is over the cap.
 */
export function enforceWaveZoneCap(state: GameState): GameState {
  const counts = new Map<string, number>()
  for (const wave of state.waves) {
    const key = `${wave.team}:${wave.zone}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let overCap = false
  for (const count of counts.values()) {
    if (count > MAX_WAVE_UNITS_PER_ZONE_PER_TEAM) {
      overCap = true
      break
    }
  }
  if (!overCap) return state

  // Walk newest → oldest keeping up to the cap per team+zone, then restore
  // original (spawn) order.
  const kept: WaveUnitState[] = []
  const keptCounts = new Map<string, number>()
  for (let i = state.waves.length - 1; i >= 0; i--) {
    const wave = state.waves[i]!
    const key = `${wave.team}:${wave.zone}`
    const keptSoFar = keptCounts.get(key) ?? 0
    if (keptSoFar < MAX_WAVE_UNITS_PER_ZONE_PER_TEAM) {
      kept.push(wave)
      keptCounts.set(key, keptSoFar + 1)
    }
  }
  kept.reverse()

  return { ...state, waves: kept }
}
