import type { GameState } from '~~/shared/types/game'
import type {
  GameEngineEvent,
  TenantDamageEvent,
  TenantRespawnEvent,
  TenantKilledInternalEvent,
  BackupPickedEvent,
} from '~~/server/game/protocol/events'
import { TENANT_ATTACK, TENANT_BACKUP_CYCLES, TENANT_SCRIP } from '~~/shared/constants/balance'
import { shouldTenantRespawn, respawnTenant } from '~~/server/game/map/spawner'

export interface TenantAction {
  targetId: string
  damage: number
}

/**
 * Tenant AI: attacks heroes in hollow, handles death/respawn.
 */
export function runTenantAI(state: GameState): TenantAction[] {
  const actions: TenantAction[] = []
  const tenant = state.tenant

  // Tenant does nothing if dead or doesn't exist
  if (!tenant || !tenant.alive) return actions

  // Find enemy heroes in hollow (same zone)
  const enemyHeroes = Object.values(state.players).filter(
    (p) => p && p.zone === 'hollow' && p.alive,
  )

  // Attack the lowest INTEG enemy hero in range
  if (enemyHeroes.length > 0) {
    const target = enemyHeroes.reduce((lowest, hero) => (hero.integ < lowest.integ ? hero : lowest))
    actions.push({
      targetId: target.id,
      damage: TENANT_ATTACK,
    })
  }

  return actions
}

/**
 * Process Tenant damage from player attacks and check for death.
 * Returns updated state (with events kept OFF state.events — callers merge the
 * returned events array into the tick's allEvents) plus the events to emit.
 */
export function processTenantDamage(
  state: GameState,
  damageDealt: Map<string, number>, // playerId -> damage
): { state: GameState; tenantKilled: boolean; backupDropped: boolean; events: GameEngineEvent[] } {
  let tenant = { ...state.tenant }
  const events: GameEngineEvent[] = []
  let tenantKilled = false
  let backupDropped = false

  // Only alive Tenant can take damage
  if (!tenant.alive) {
    // Check for respawn
    if (shouldTenantRespawn(tenant, state.cycle)) {
      tenant = respawnTenant(tenant, state.cycle)
      events.push({
        _tag: 'tenant_respawn',
        cycle: state.cycle,
        integ: tenant.integ,
        maxInteg: tenant.maxInteg,
      } satisfies TenantRespawnEvent)
    }
    return {
      state: { ...state, tenant },
      tenantKilled: false,
      backupDropped: false,
      events,
    }
  }

  // Calculate total damage to Tenant this cycle
  let totalDamage = 0
  for (const [, damage] of damageDealt) {
    totalDamage += damage
  }

  if (totalDamage > 0) {
    const newInteg = Math.max(0, tenant.integ - totalDamage)
    tenant = { ...tenant, integ: newInteg }

    events.push({
      _tag: 'tenant_damage',
      cycle: state.cycle,
      damage: totalDamage,
      integ: newInteg,
      maxInteg: tenant.maxInteg,
    } satisfies TenantDamageEvent)

    // Tenant died
    if (newInteg <= 0) {
      tenantKilled = true
      backupDropped = true

      // Update Tenant state to dead
      tenant = {
        alive: false,
        integ: 0,
        maxInteg: tenant.maxInteg,
        deathCycle: state.cycle,
      }

      // Drop backup in hollow
      const backup = {
        zone: 'hollow',
        cycle: state.cycle,
        holderId: null as string | null,
      }

      // Award scrip to damaging players (distributed by damage dealt)
      const totalDmg = Array.from(damageDealt.values()).reduce((a, b) => a + b, 0)
      const players = { ...state.players }
      let remainingGold = TENANT_SCRIP

      for (const [playerId, damage] of damageDealt) {
        const share = Math.floor((damage / totalDmg) * remainingGold)
        const player = players[playerId]
        if (player) {
          players[playerId] = { ...player, scrip: player.scrip + share }
          remainingGold -= share
        }
      }

      // Give remaining scrip to lowest INTEG damage dealer
      if (remainingGold > 0) {
        let lowestDmgDealer = ''
        let lowestHp = Infinity
        for (const [playerId, damage] of damageDealt) {
          if (damage > 0) {
            const player = players[playerId]
            if (player && player.integ < lowestHp) {
              lowestHp = player.integ
              lowestDmgDealer = playerId
            }
          }
        }
        if (lowestDmgDealer) {
          const player = players[lowestDmgDealer]!
          players[lowestDmgDealer] = { ...player, scrip: player.scrip + remainingGold }
        }
      }

      events.push({
        _tag: 'tenant_killed',
        cycle: state.cycle,
      } satisfies TenantKilledInternalEvent)

      return {
        state: { ...state, players, tenant, backup },
        tenantKilled: true,
        backupDropped: true,
        events,
      }
    }
  }

  return {
    state: { ...state, tenant },
    tenantKilled,
    backupDropped,
    events,
  }
}

/**
 * Handle backup pickup by a player. Returns the updated state; the backup_picked
 * event is returned separately so the caller (ActionResolver) can merge it into
 * the tick's allEvents instead of mutating state.events.
 */
export function pickupBackup(
  state: GameState,
  playerId: string,
): { state: GameState; event: GameEngineEvent | null } {
  const backup = state.backup
  if (!backup) return { state, event: null }

  const player = state.players[playerId]
  if (!player || !player.alive) return { state, event: null }

  // Player must be in hollow to pick up backup
  if (player.zone !== 'hollow') return { state, event: null }

  // Add backup buff to player (respawn speed)
  const backupBuff = {
    id: 'backup',
    stacks: TENANT_BACKUP_CYCLES,
    cyclesRemaining: TENANT_BACKUP_CYCLES,
    source: 'tenant',
  }

  const players = {
    ...state.players,
    [playerId]: {
      ...player,
      buffs: [...player.buffs, backupBuff],
    },
  }

  return {
    state: { ...state, players, backup: null },
    event: { _tag: 'backup_picked', cycle: state.cycle, playerId } satisfies BackupPickedEvent,
  }
}
