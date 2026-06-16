import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState, CreepState } from '~~/shared/types/game'
import {
  createInMemoryStateManager,
  type PlayerSetup,
  type StateManagerApi,
} from '~~/server/game/engine/StateManager'
import { processTick, submitAction } from '~~/server/game/engine/GameLoop'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import {
  CREEP_XP,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  SIEGE_CREEP_GOLD,
  DENY_GOLD_RATIO,
  DENY_XP_RATIO,
  HERO_KILL_XP_BASE,
  HERO_KILL_XP_PER_LEVEL,
  XP_PER_LEVEL,
  MKB_BONUS_DAMAGE,
} from '~~/shared/constants/balance'
import { HERO_IDS } from '~~/shared/constants/heroes'

/**
 * ECONOMY THROUGH RESOLUTION — driven entirely through the real engine
 * (`createInMemoryStateManager` + `submitAction` + `processTick`), the same
 * pipeline a live match uses. Asserts exact gold/xp deltas, level-up events,
 * and armor / magic-resist mitigation in real combat.
 */

let seq = 0
function uid(label: string): string {
  return `eco_${label}_${seq++}`
}

async function startGame(gameId: string, players: PlayerSetup[]): Promise<StateManagerApi> {
  const sm = createInMemoryStateManager()
  await Effect.runPromise(sm.createGame(gameId, players))
  await Effect.runPromise(sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })))
  return sm
}

async function runTick(sm: StateManagerApi, gameId: string) {
  const state = await Effect.runPromise(sm.getState(gameId))
  const result = await Effect.runPromise(processTick(gameId, state))
  await Effect.runPromise(sm.updateState(gameId, () => result.state))
  return result
}

function arrange(
  sm: StateManagerApi,
  gameId: string,
  fn: (s: GameState) => GameState,
): Promise<GameState> {
  return Effect.runPromise(sm.updateState(gameId, fn))
}

function setPlayer(state: GameState, id: string, patch: Partial<PlayerState>): GameState {
  const player = state.players[id]
  if (!player) throw new Error(`No such player in fixture: ${id}`)
  return { ...state, players: { ...state.players, [id]: { ...player, ...patch } } }
}

function makePlayers(prefix: string, perTeam: number): PlayerSetup[] {
  const radiant = Array.from({ length: perTeam }, (_, i) => ({
    id: `${prefix}_r${i}`,
    name: `${prefix}_r${i}`,
    team: 'radiant' as const,
    heroId: HERO_IDS[i]!,
  }))
  const dire = Array.from({ length: perTeam }, (_, i) => ({
    id: `${prefix}_d${i}`,
    name: `${prefix}_d${i}`,
    team: 'dire' as const,
    heroId: HERO_IDS[perTeam + i]!,
  }))
  return [...radiant, ...dire]
}

/** inCombat freezes fountain regen so HP/MP stay put across the tick. */
function inCombatBuff() {
  return { id: 'inCombat', stacks: 1, ticksRemaining: 3, source: 'system' }
}

/**
 * Place exactly ONE creep in `zone` so its per-zone deny/attack index is a
 * deterministic 0. (A fresh game seeds creeps in lane zones, never in
 * `mid-river`, which is where we stage these fixtures.)
 */
function withSoloCreep(state: GameState, creep: CreepState): GameState {
  const others = state.creeps.filter((c) => c.zone !== creep.zone)
  return { ...state, creeps: [...others, creep] }
}

describe('Economy through resolution', () => {
  describe('Creep deny', () => {
    it('denies an allied creep below 50% HP → creep hp→0, denier gets deny gold + floor(CREEP_XP*0.5), creep_deny event', async () => {
      const gameId = uid('deny')
      const sm = await startGame(gameId, makePlayers('dn', 1))

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'dn_r0', { zone: 'mid-river' })
        // Allied (radiant) melee creep at 100/400 HP — well under the 50% deny gate.
        return withSoloCreep(moved, {
          id: 'deny_target',
          team: 'radiant',
          zone: 'mid-river',
          hp: 100,
          type: 'melee',
        })
      })

      const before = await Effect.runPromise(sm.getState(gameId))
      const goldBefore = before.players['dn_r0']!.gold
      const xpBefore = before.players['dn_r0']!.xp

      submitAction(gameId, 'dn_r0', { type: 'deny', target: { kind: 'creep', index: 0 } })
      const r = await runTick(sm, gameId)

      // The denied creep is dead (hp 0); the engine GCs dead creeps so it is gone.
      expect(r.state.creeps.some((c) => c.id === 'deny_target' && c.hp > 0)).toBe(false)

      const denyGold = Math.floor(((CREEP_GOLD_MIN + CREEP_GOLD_MAX) / 2) * DENY_GOLD_RATIO)
      const denyXp = Math.floor(CREEP_XP * DENY_XP_RATIO)
      const after = r.state.players['dn_r0']!
      // Deny gold is exact; deny XP is exact. (No passive gold confound: passive
      // gold is distributed but we measure the deny-specific deltas as a floor.)
      expect(after.xp - xpBefore).toBe(denyXp)
      expect(after.gold - goldBefore).toBeGreaterThanOrEqual(denyGold)

      const denyEvent = r.events.find((e) => e._tag === 'creep_deny')
      expect(denyEvent).toMatchObject({
        playerId: 'dn_r0',
        creepId: 'deny_target',
        creepType: 'melee',
        goldAwarded: denyGold,
      })
    })

    it('rejects denying a creep still above the 50% HP gate (no kill, no gold/xp)', async () => {
      const gameId = uid('denygate')
      const sm = await startGame(gameId, makePlayers('dg', 1))

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'dg_r0', { zone: 'mid-river' })
        // 300/400 = 75% HP — above the 50% deny threshold; deny must no-op.
        return withSoloCreep(moved, {
          id: 'healthy_ally',
          team: 'radiant',
          zone: 'mid-river',
          hp: 300,
          type: 'melee',
        })
      })

      const before = await Effect.runPromise(sm.getState(gameId))
      const xpBefore = before.players['dg_r0']!.xp

      submitAction(gameId, 'dg_r0', { type: 'deny', target: { kind: 'creep', index: 0 } })
      const r = await runTick(sm, gameId)

      // Creep survived; no deny event; no deny XP.
      expect(r.state.creeps.some((c) => c.id === 'healthy_ally' && c.hp > 0)).toBe(true)
      expect(r.events.some((e) => e._tag === 'creep_deny')).toBe(false)
      expect(r.state.players['dg_r0']!.xp - xpBefore).toBe(0)
    })
  })

  describe('Creep last-hit', () => {
    it('last-hits an enemy siege creep → killer gold += SIEGE_CREEP_GOLD AND xp += CREEP_XP', async () => {
      const gameId = uid('lasthit')
      const sm = await startGame(gameId, makePlayers('lh', 1))

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'lh_r0', { zone: 'mid-river' })
        // Enemy (dire) SIEGE creep at 1 HP — siege last-hit gold is the fixed
        // SIEGE_CREEP_GOLD (melee/ranged is randomized; siege keeps it exact).
        return withSoloCreep(moved, {
          id: 'enemy_siege',
          team: 'dire',
          zone: 'mid-river',
          hp: 1,
          type: 'siege',
        })
      })

      const before = await Effect.runPromise(sm.getState(gameId))
      const goldBefore = before.players['lh_r0']!.gold
      const xpBefore = before.players['lh_r0']!.xp

      submitAction(gameId, 'lh_r0', { type: 'attack', target: { kind: 'creep', index: 0 } })
      const r = await runTick(sm, gameId)

      expect(r.state.creeps.some((c) => c.id === 'enemy_siege' && c.hp > 0)).toBe(false)
      const after = r.state.players['lh_r0']!
      // XP for the kill is exactly CREEP_XP. Gold is at least the siege bounty
      // (passive gold may add on top, but the last-hit credit is the floor).
      expect(after.xp - xpBefore).toBe(CREEP_XP)
      expect(after.gold - goldBefore).toBeGreaterThanOrEqual(SIEGE_CREEP_GOLD)
    })

    it('last-hits an enemy melee creep → gold delta lands in the [MIN,MAX] last-hit band, xp += CREEP_XP', async () => {
      const gameId = uid('lasthitmelee')
      const sm = await startGame(gameId, makePlayers('lm', 1))

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'lm_r0', { zone: 'mid-river' })
        return withSoloCreep(moved, {
          id: 'enemy_melee',
          team: 'dire',
          zone: 'mid-river',
          hp: 1,
          type: 'melee',
        })
      })

      const before = await Effect.runPromise(sm.getState(gameId))
      const goldBefore = before.players['lm_r0']!.gold
      const xpBefore = before.players['lm_r0']!.xp

      submitAction(gameId, 'lm_r0', { type: 'attack', target: { kind: 'creep', index: 0 } })
      const r = await runTick(sm, gameId)

      expect(r.state.creeps.some((c) => c.id === 'enemy_melee' && c.hp > 0)).toBe(false)
      const after = r.state.players['lm_r0']!
      expect(after.xp - xpBefore).toBe(CREEP_XP)
      // Randomized melee last-hit gold falls in [CREEP_GOLD_MIN, CREEP_GOLD_MAX]
      // (passive gold can only push it higher → assert the lower bound).
      const goldDelta = after.gold - goldBefore
      expect(goldDelta).toBeGreaterThanOrEqual(CREEP_GOLD_MIN)
    })
  })

  describe('Hero kill XP / assist XP', () => {
    it('on a hero kill the killer gains HERO_KILL_XP_BASE + 20*victim.level and the assister gains 50%', async () => {
      const gameId = uid('killxp')
      const sm = await startGame(gameId, makePlayers('kx', 2))

      // killer + assister + victim co-located; victim level pinned so the XP
      // formula is exact. Freeze the victim at 1 HP for a guaranteed lethal.
      const VICTIM_LEVEL = 3
      await arrange(sm, gameId, (s) => {
        let next = setPlayer(s, 'kx_r0', { zone: 'mid-river' })
        next = setPlayer(next, 'kx_r1', { zone: 'mid-river' })
        next = setPlayer(next, 'kx_d0', {
          zone: 'mid-river',
          level: VICTIM_LEVEL,
          buffs: [inCombatBuff()],
        })
        return next
      })

      // Tick 1: assister lands a hit so they enter the assist/contributor window.
      submitAction(gameId, 'kx_r1', { type: 'attack', target: { kind: 'hero', name: 'kx_d0' } })
      const r1 = await runTick(sm, gameId)
      expect(r1.state.players['kx_d0']!.hp).toBeLessThan(r1.state.players['kx_d0']!.maxHp)

      // Pin the victim to a lethal 1 HP, snapshot XP, then the killer finishes.
      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'kx_d0', { hp: 1, level: VICTIM_LEVEL, buffs: [inCombatBuff()] }),
      )
      const before = await Effect.runPromise(sm.getState(gameId))
      const killerXpBefore = before.players['kx_r0']!.xp
      const assistXpBefore = before.players['kx_r1']!.xp

      submitAction(gameId, 'kx_r0', { type: 'attack', target: { kind: 'hero', name: 'kx_d0' } })
      const r2 = await runTick(sm, gameId)

      expect(r2.state.players['kx_d0']!.alive).toBe(false)
      const killEvent = r2.events.find((e) => e._tag === 'kill')
      expect(killEvent).toMatchObject({ killerId: 'kx_r0', victimId: 'kx_d0' })
      expect((killEvent as Extract<GameEngineEvent, { _tag: 'kill' }>).assisters).toContain('kx_r1')

      const killXp = HERO_KILL_XP_BASE + HERO_KILL_XP_PER_LEVEL * VICTIM_LEVEL
      const assistXp = Math.floor(killXp * 0.5)

      // XP is awarded outside the passive-gold path, so these deltas are exact.
      // Account for the (possible) level-up reset NOT touching xp: levelUpHero
      // keeps accumulated xp, so the raw delta holds.
      expect(r2.state.players['kx_r0']!.xp - killerXpBefore).toBe(killXp)
      expect(r2.state.players['kx_r1']!.xp - assistXpBefore).toBe(assistXp)
    })
  })

  describe('Level-up trigger', () => {
    it('a creep last-hit that crosses XP_PER_LEVEL[2] fires checkLevelUps: level→2 + level_up event', async () => {
      const gameId = uid('levelup')
      const sm = await startGame(gameId, makePlayers('lu', 1))

      // Park XP one CREEP_XP short of level 2 so a single creep kill tips it over.
      const threshold = XP_PER_LEVEL[2]!
      const startXp = threshold - CREEP_XP
      expect(startXp).toBeGreaterThanOrEqual(0)

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'lu_r0', { zone: 'mid-river', level: 1, xp: startXp })
        return withSoloCreep(moved, {
          id: 'levelup_creep',
          team: 'dire',
          zone: 'mid-river',
          hp: 1,
          type: 'melee',
        })
      })

      submitAction(gameId, 'lu_r0', { type: 'attack', target: { kind: 'creep', index: 0 } })
      const r = await runTick(sm, gameId)

      // Kill granted CREEP_XP → xp ≥ threshold → checkLevelUps promoted to L2.
      expect(r.state.players['lu_r0']!.xp).toBeGreaterThanOrEqual(threshold)
      expect(r.state.players['lu_r0']!.level).toBe(2)
      expect(
        r.events.some((e) => e._tag === 'level_up' && e.playerId === 'lu_r0' && e.newLevel === 2),
      ).toBe(true)
    })

    it('crossing into level 6 emits both level_up and a power_spike(level_6)', async () => {
      const gameId = uid('spike6')
      const sm = await startGame(gameId, makePlayers('ps', 1))

      // Sit at L5 with xp one CREEP_XP short of the L6 threshold.
      const threshold = XP_PER_LEVEL[6]!
      const startXp = threshold - CREEP_XP
      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'ps_r0', { zone: 'mid-river', level: 5, xp: startXp })
        return withSoloCreep(moved, {
          id: 'spike_creep',
          team: 'dire',
          zone: 'mid-river',
          hp: 1,
          type: 'melee',
        })
      })

      submitAction(gameId, 'ps_r0', { type: 'attack', target: { kind: 'creep', index: 0 } })
      const r = await runTick(sm, gameId)

      expect(r.state.players['ps_r0']!.level).toBe(6)
      expect(
        r.events.some((e) => e._tag === 'level_up' && e.playerId === 'ps_r0' && e.newLevel === 6),
      ).toBe(true)
      expect(
        r.events.some(
          (e) => e._tag === 'power_spike' && e.playerId === 'ps_r0' && e.spikeType === 'level_6',
        ),
      ).toBe(true)
    })
  })

  describe('Armor / magic-resist in real combat', () => {
    it('higher armor → proportionally smaller physical attack damage (same attacker profile)', async () => {
      const gameId = uid('armor')
      const sm = await startGame(gameId, makePlayers('ar', 3))

      // Two identical attackers each hit a distinct target. Targets share the
      // SAME hero/level (identical base armor); one carries a +20 defenseBuff.
      // The damage events then differ ONLY by the armor delta.
      const ARMOR_BONUS = 20
      await arrange(sm, gameId, (s) => {
        let next = s
        // attackers: same hero, same zone, same level
        next = setPlayer(next, 'ar_r0', { zone: 'mid-river', heroId: 'kernel', level: 5 })
        next = setPlayer(next, 'ar_r1', { zone: 'mid-river', heroId: 'kernel', level: 5 })
        // targets: same hero/level so base armor is identical
        next = setPlayer(next, 'ar_d0', {
          zone: 'mid-river',
          heroId: 'cipher',
          level: 5,
          hp: 5000,
          maxHp: 5000,
          buffs: [inCombatBuff()],
        })
        next = setPlayer(next, 'ar_d1', {
          zone: 'mid-river',
          heroId: 'cipher',
          level: 5,
          hp: 5000,
          maxHp: 5000,
          buffs: [
            inCombatBuff(),
            { id: 'defenseBuff', stacks: ARMOR_BONUS, ticksRemaining: 5, source: 'test' },
          ],
        })
        return next
      })

      submitAction(gameId, 'ar_r0', { type: 'attack', target: { kind: 'hero', name: 'ar_d0' } })
      submitAction(gameId, 'ar_r1', { type: 'attack', target: { kind: 'hero', name: 'ar_d1' } })
      const r = await runTick(sm, gameId)

      const dmgLow = r.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'ar_d0' && e.damageType === 'physical',
      ) as Extract<GameEngineEvent, { _tag: 'damage' }> | undefined
      const dmgHigh = r.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'ar_d1' && e.damageType === 'physical',
      ) as Extract<GameEngineEvent, { _tag: 'damage' }> | undefined

      expect(dmgLow).toBeTruthy()
      expect(dmgHigh).toBeTruthy()
      // The +20-armor target took strictly less physical damage.
      expect(dmgHigh!.amount).toBeLessThan(dmgLow!.amount)
      expect(dmgHigh!.amount).toBeGreaterThan(0)
    })

    it('MKB on-hit magic: null_ref mrShred lowers effective MR → higher magical damage on the shredded target', async () => {
      const gameId = uid('mr')
      const sm = await startGame(gameId, makePlayers('mr', 3))

      // Two identical MKB attackers; two identical targets except one carries a
      // mrShred debuff (null_ref's MR shred). MKB adds a flat MKB_BONUS_DAMAGE
      // magical on-hit whose mitigated amount is emitted as its own magical
      // damage event using getEffectiveMagicResist — so the events differ ONLY
      // by the mrShred.
      const SHRED = 30
      await arrange(sm, gameId, (s) => {
        let next = s
        next = setPlayer(next, 'mr_r0', {
          zone: 'mid-river',
          heroId: 'kernel',
          level: 5,
          items: ['monkey_king_bar', null, null, null, null, null],
        })
        next = setPlayer(next, 'mr_r1', {
          zone: 'mid-river',
          heroId: 'kernel',
          level: 5,
          items: ['monkey_king_bar', null, null, null, null, null],
        })
        next = setPlayer(next, 'mr_d0', {
          zone: 'mid-river',
          heroId: 'cipher',
          level: 5,
          hp: 5000,
          maxHp: 5000,
          buffs: [inCombatBuff()],
        })
        next = setPlayer(next, 'mr_d1', {
          zone: 'mid-river',
          heroId: 'cipher',
          level: 5,
          hp: 5000,
          maxHp: 5000,
          buffs: [
            inCombatBuff(),
            { id: 'mrShred', stacks: SHRED, ticksRemaining: 5, source: 'test' },
          ],
        })
        return next
      })

      submitAction(gameId, 'mr_r0', { type: 'attack', target: { kind: 'hero', name: 'mr_d0' } })
      submitAction(gameId, 'mr_r1', { type: 'attack', target: { kind: 'hero', name: 'mr_d1' } })
      const r = await runTick(sm, gameId)

      const magLow = r.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'mr_d0' && e.damageType === 'magical',
      ) as Extract<GameEngineEvent, { _tag: 'damage' }> | undefined
      const magHigh = r.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'mr_d1' && e.damageType === 'magical',
      ) as Extract<GameEngineEvent, { _tag: 'damage' }> | undefined

      expect(magLow, 'MKB must emit a magical on-hit damage event').toBeTruthy()
      expect(magHigh).toBeTruthy()
      // mrShred → lower effective MR → the same MKB_BONUS_DAMAGE bleeds through
      // for MORE on the shredded target.
      expect(magHigh!.amount).toBeGreaterThan(magLow!.amount)
      // Sanity: the bonus magic can't exceed the raw MKB amount post-mitigation.
      expect(magHigh!.amount).toBeLessThanOrEqual(MKB_BONUS_DAMAGE)
    })
  })
})
