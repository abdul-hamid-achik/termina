/**
 * Socket's Listen traps. resolveW (socket.ts) arms an invisible TrapState in a
 * zone; this pass detonates it. Each tick, for every armed trap:
 *   - if expired (tick >= expiryTick), disarm it silently;
 *   - else if an enemy hero occupies the zone, detonate on the first one —
 *     code damage + a `revealed` buff (consumed by VisionCalculator) — and
 *     consume the trap;
 *   - otherwise leave it armed.
 *
 * Runs right after action/movement resolution so a hero that moved INTO a
 * trapped zone this cycle is caught the same tick. Emits a `damage` engine event
 * (kill/assist credit + client damage float) and a `trap_triggered` event
 * (narrative).
 */
import type { GameState, PlayerState, TrapState } from '~~/shared/types/game'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import { dealDamage, applyBuff, updatePlayer } from '~~/server/game/heroes/_base'

export function processTraps(state: GameState): { state: GameState; events: GameEngineEvent[] } {
  let updated = state
  const events: GameEngineEvent[] = []
  const zones = { ...state.zones }
  let zonesChanged = false

  for (const [zoneId, zone] of Object.entries(state.zones)) {
    const traps = zone.traps
    if (!traps || traps.length === 0) continue

    const remaining: TrapState[] = []
    for (const trap of traps) {
      if (state.cycle >= trap.expiryTick) continue // expired — disarm silently

      // First enemy hero standing in the trapped zone (re-read from `updated`
      // so a trap can't hit someone an earlier trap already killed this cycle).
      const victim = Object.values(updated.players).find(
        (p): p is PlayerState =>
          p.alive && p.heroId !== null && p.team !== trap.team && p.zone === zoneId,
      )
      if (!victim) {
        remaining.push(trap)
        continue
      }

      const damaged = dealDamage(victim, trap.damage, 'code')
      const dealt = victim.integ - damaged.integ
      const revealed = applyBuff(damaged, {
        id: 'revealed',
        stacks: 1,
        cyclesRemaining: trap.revealDuration,
        source: trap.owner,
      })
      updated = updatePlayer(updated, revealed)

      events.push({
        _tag: 'damage',
        cycle: state.cycle,
        sourceId: trap.owner,
        targetId: victim.id,
        amount: dealt,
        damageType: 'code',
      })
      events.push({
        _tag: 'trap_triggered',
        cycle: state.cycle,
        owner: trap.owner,
        team: trap.team,
        zone: zoneId,
        targetId: victim.id,
        damage: dealt,
      })
      // trap consumed — not pushed to `remaining`
    }

    if (remaining.length !== traps.length) {
      zones[zoneId] = { ...zone, traps: remaining }
      zonesChanged = true
    }
  }

  if (zonesChanged) {
    updated = { ...updated, zones }
  }
  return { state: updated, events }
}
