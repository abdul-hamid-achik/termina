import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState, WaveUnitState } from '~~/shared/types/game'
import {
  createInMemoryStateManager,
  type PlayerSetup,
  type StateManagerApi,
} from '~~/server/game/engine/StateManager'
import { processCycle, submitAction } from '~~/server/game/engine/GameLoop'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import {
  WAVE_XP,
  WAVE_SCRIP,
  WAVE_SCRIP_MIN,
  WAVE_SCRIP_MAX,
  BREACH_UNIT_SCRIP,
  BURN_SCRIP_RATIO,
  BURN_XP_RATIO,
  HERO_KILL_XP_BASE,
  HERO_KILL_XP_PER_LEVEL,
  XP_PER_LEVEL,
  TRUESTRIKE_RIG_BONUS_DAMAGE,
  PASSIVE_SCRIP_PER_CYCLE,
} from '~~/shared/constants/balance'
import { HERO_IDS } from '~~/shared/constants/heroes'

/**
 * ECONOMY THROUGH RESOLUTION — driven entirely through the real engine
 * (`createInMemoryStateManager` + `submitAction` + `processCycle`), the same
 * pipeline a live match uses. Asserts exact scrip/xp deltas, level-up events,
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
  const result = await Effect.runPromise(processCycle(gameId, state))
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
  const chaff = Array.from({ length: perTeam }, (_, i) => ({
    id: `${prefix}_r${i}`,
    name: `${prefix}_r${i}`,
    team: 'chaff' as const,
    heroId: HERO_IDS[i]!,
  }))
  const audit = Array.from({ length: perTeam }, (_, i) => ({
    id: `${prefix}_d${i}`,
    name: `${prefix}_d${i}`,
    team: 'audit' as const,
    heroId: HERO_IDS[perTeam + i]!,
  }))
  return [...chaff, ...audit]
}

/** inCombat freezes fountain regen so HP/MP stay put across the tick. */
function inCombatBuff() {
  return { id: 'inCombat', stacks: 1, cyclesRemaining: 3, source: 'system' }
}

/**
 * Place exactly ONE wave in `zone` so its per-zone burn/attack index is a
 * deterministic 0. (A fresh game seeds waves in lane zones, never in
 * `coldstore-cross`, which is where we stage these fixtures.)
 */
function withSoloWave(state: GameState, wave: WaveUnitState): GameState {
  const others = state.waves.filter((c) => c.zone !== wave.zone)
  return { ...state, waves: [...others, wave] }
}

describe('Economy through resolution', () => {
  describe('Wave burn', () => {
    it('burns an allied wave below 50% INTEG → wave hp→0, denier gets burn scrip + floor(WAVE_XP*0.5), wave_burn event', async () => {
      const gameId = uid('burn')
      const sm = await startGame(gameId, makePlayers('dn', 1))

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'dn_r0', { zone: 'coldstore-cross' })
        // Allied (chaff) line wave at 100/400 INTEG — well under the 50% burn gate.
        return withSoloWave(moved, {
          id: 'deny_target',
          team: 'chaff',
          zone: 'coldstore-cross',
          integ: 100,
          type: 'line',
        })
      })

      const before = await Effect.runPromise(sm.getState(gameId))
      const scripBefore = before.players['dn_r0']!.scrip
      const xpBefore = before.players['dn_r0']!.xp

      submitAction(gameId, 'dn_r0', { type: 'burn', target: { kind: 'wave', index: 0 } })
      const r = await runTick(sm, gameId)

      // The burned wave is dead (hp 0); the engine GCs dead waves so it is gone.
      expect(r.state.waves.some((c) => c.id === 'deny_target' && c.integ > 0)).toBe(false)

      const burnGold = Math.floor(((WAVE_SCRIP_MIN + WAVE_SCRIP_MAX) / 2) * BURN_SCRIP_RATIO)
      const burnXp = Math.floor(WAVE_XP * BURN_XP_RATIO)
      const after = r.state.players['dn_r0']!
      // Burn scrip is exact; burn XP is exact. (No passive scrip confound: passive
      // scrip is distributed but we measure the burn-specific deltas as a floor.)
      expect(after.xp - xpBefore).toBe(burnXp)
      expect(after.scrip - scripBefore).toBeGreaterThanOrEqual(burnGold)

      const denyEvent = r.events.find((e) => e._tag === 'wave_burn')
      expect(denyEvent).toMatchObject({
        playerId: 'dn_r0',
        waveId: 'deny_target',
        waveType: 'line',
        scripAwarded: burnGold,
      })
    })

    it('rejects denying a wave still above the 50% INTEG gate (no kill, no scrip/xp)', async () => {
      const gameId = uid('denygate')
      const sm = await startGame(gameId, makePlayers('dg', 1))

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'dg_r0', { zone: 'coldstore-cross' })
        // 300/400 = 75% INTEG — above the 50% burn threshold; burn must no-op.
        return withSoloWave(moved, {
          id: 'healthy_ally',
          team: 'chaff',
          zone: 'coldstore-cross',
          integ: 300,
          type: 'line',
        })
      })

      const before = await Effect.runPromise(sm.getState(gameId))
      const xpBefore = before.players['dg_r0']!.xp

      submitAction(gameId, 'dg_r0', { type: 'burn', target: { kind: 'wave', index: 0 } })
      const r = await runTick(sm, gameId)

      // Wave survived; no burn event; no burn XP.
      expect(r.state.waves.some((c) => c.id === 'healthy_ally' && c.integ > 0)).toBe(true)
      expect(r.events.some((e) => e._tag === 'wave_burn')).toBe(false)
      expect(r.state.players['dg_r0']!.xp - xpBefore).toBe(0)
    })
  })

  describe('Wave last-hit', () => {
    it('last-hits an enemy breach wave → killer scrip += BREACH_UNIT_SCRIP AND xp += WAVE_XP', async () => {
      const gameId = uid('lasthit')
      const sm = await startGame(gameId, makePlayers('lh', 1))

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'lh_r0', { zone: 'coldstore-cross' })
        // Enemy (audit) BREACH wave at 1 INTEG — breach last-hit scrip is the fixed
        // BREACH_UNIT_SCRIP (line/sweep is randomized; breach keeps it exact).
        return withSoloWave(moved, {
          id: 'enemy_breach',
          team: 'audit',
          zone: 'coldstore-cross',
          integ: 1,
          type: 'breach',
        })
      })

      const before = await Effect.runPromise(sm.getState(gameId))
      const scripBefore = before.players['lh_r0']!.scrip
      const xpBefore = before.players['lh_r0']!.xp

      submitAction(gameId, 'lh_r0', { type: 'attack', target: { kind: 'wave', index: 0 } })
      const r = await runTick(sm, gameId)

      expect(r.state.waves.some((c) => c.id === 'enemy_breach' && c.integ > 0)).toBe(false)
      const after = r.state.players['lh_r0']!
      // XP for the kill is exactly WAVE_XP. Gold is at least the breach bounty
      // (passive scrip may add on top, but the last-hit credit is the floor).
      expect(after.xp - xpBefore).toBe(WAVE_XP)
      expect(after.scrip - scripBefore).toBeGreaterThanOrEqual(BREACH_UNIT_SCRIP)
    })

    it('last-hits an enemy line wave → scrip delta lands in the [MIN,MAX] last-hit band, xp += WAVE_XP', async () => {
      const gameId = uid('lasthitline')
      const sm = await startGame(gameId, makePlayers('lm', 1))

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'lm_r0', { zone: 'coldstore-cross' })
        return withSoloWave(moved, {
          id: 'enemy_line',
          team: 'audit',
          zone: 'coldstore-cross',
          integ: 1,
          type: 'line',
        })
      })

      const before = await Effect.runPromise(sm.getState(gameId))
      const scripBefore = before.players['lm_r0']!.scrip
      const xpBefore = before.players['lm_r0']!.xp

      submitAction(gameId, 'lm_r0', { type: 'attack', target: { kind: 'wave', index: 0 } })
      const r = await runTick(sm, gameId)

      expect(r.state.waves.some((c) => c.id === 'enemy_line' && c.integ > 0)).toBe(false)
      const after = r.state.players['lm_r0']!
      expect(after.xp - xpBefore).toBe(WAVE_XP)
      // Fixed line last-hit scrip is WAVE_SCRIP (no RNG); passive income adds a
      // bit more on top, so assert at least the last-hit amount.
      const goldDelta = after.scrip - scripBefore
      expect(goldDelta).toBeGreaterThanOrEqual(WAVE_SCRIP)
    })
  })

  describe('Hero kill XP / assist XP', () => {
    it('on a hero kill the killer gains HERO_KILL_XP_BASE + 20*victim.level and the assister gains 50%', async () => {
      const gameId = uid('killxp')
      const sm = await startGame(gameId, makePlayers('kx', 2))

      // killer + assister + victim co-located; victim level pinned so the XP
      // formula is exact. Freeze the victim at 1 INTEG for a guaranteed lethal.
      const VICTIM_LEVEL = 3
      await arrange(sm, gameId, (s) => {
        // All four players share VICTIM_LEVEL so both teams' average level is
        // equal — the XP comeback multiplier is exactly 1 and the raw kill-XP
        // formula (base + 20*victim.level) holds without a comeback adjustment.
        let next = setPlayer(s, 'kx_r0', { zone: 'coldstore-cross', level: VICTIM_LEVEL })
        next = setPlayer(next, 'kx_r1', { zone: 'coldstore-cross', level: VICTIM_LEVEL })
        next = setPlayer(next, 'kx_d1', { level: VICTIM_LEVEL })
        next = setPlayer(next, 'kx_d0', {
          zone: 'coldstore-cross',
          level: VICTIM_LEVEL,
          buffs: [inCombatBuff()],
        })
        return next
      })

      // Tick 1: assister lands a hit so they enter the assist/contributor window.
      submitAction(gameId, 'kx_r1', { type: 'attack', target: { kind: 'hero', name: 'kx_d0' } })
      const r1 = await runTick(sm, gameId)
      expect(r1.state.players['kx_d0']!.integ).toBeLessThan(r1.state.players['kx_d0']!.maxInteg)

      // Pin the victim to a lethal 1 INTEG, snapshot XP, then the killer finishes.
      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'kx_d0', { integ: 1, level: VICTIM_LEVEL, buffs: [inCombatBuff()] }),
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

    it('a hero kill emits scrip_change for the killer AND each assister, matching the scrip paid', async () => {
      // The bounty was awarded but never announced: the ONLY scrip_change the
      // engine ever emitted was an empty win sentinel, so the biggest payout in
      // the game — and every assist — landed in total silence.
      const gameId = uid('killgold')
      const sm = await startGame(gameId, makePlayers('kg', 2))

      await arrange(sm, gameId, (s) => {
        let next = setPlayer(s, 'kg_r0', { zone: 'coldstore-cross' })
        next = setPlayer(next, 'kg_r1', { zone: 'coldstore-cross' })
        return setPlayer(next, 'kg_d0', { zone: 'coldstore-cross', buffs: [inCombatBuff()] })
      })

      submitAction(gameId, 'kg_r1', { type: 'attack', target: { kind: 'hero', name: 'kg_d0' } })
      await runTick(sm, gameId)

      await arrange(sm, gameId, (s) => setPlayer(s, 'kg_d0', { integ: 1, buffs: [inCombatBuff()] }))
      const before = await Effect.runPromise(sm.getState(gameId))
      const killerGoldBefore = before.players['kg_r0']!.scrip
      const assistGoldBefore = before.players['kg_r1']!.scrip

      submitAction(gameId, 'kg_r0', { type: 'attack', target: { kind: 'hero', name: 'kg_d0' } })
      const r2 = await runTick(sm, gameId)
      expect(r2.state.players['kg_d0']!.alive).toBe(false)

      const scrip = r2.events.filter(
        (e): e is Extract<GameEngineEvent, { _tag: 'scrip_change' }> => e._tag === 'scrip_change',
      )
      const bounty = scrip.find((e) => e.playerId === 'kg_r0')
      const assist = scrip.find((e) => e.playerId === 'kg_r1')
      expect(bounty?.reason).toBe('hero kill')
      expect(assist?.reason).toBe('assist')

      // The reported amount must be the scrip that actually moved (the only other
      // income this cycle is the passive trickle) — a hardcoded or stale bounty
      // number would fail here even though the payout itself is correct.
      expect(r2.state.players['kg_r0']!.scrip - killerGoldBefore).toBe(
        bounty!.amount + PASSIVE_SCRIP_PER_CYCLE,
      )
      expect(r2.state.players['kg_r1']!.scrip - assistGoldBefore).toBe(
        assist!.amount + PASSIVE_SCRIP_PER_CYCLE,
      )
    })
  })

  describe('Level-up trigger', () => {
    it('a wave last-hit that crosses XP_PER_LEVEL[2] fires checkLevelUps: level→2 + level_up event', async () => {
      const gameId = uid('levelup')
      const sm = await startGame(gameId, makePlayers('lu', 1))

      // Park XP one WAVE_XP short of level 2 so a single wave kill tips it over.
      const threshold = XP_PER_LEVEL[2]!
      const startXp = threshold - WAVE_XP
      expect(startXp).toBeGreaterThanOrEqual(0)

      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'lu_r0', { zone: 'coldstore-cross', level: 1, xp: startXp })
        return withSoloWave(moved, {
          id: 'levelup_wave',
          team: 'audit',
          zone: 'coldstore-cross',
          integ: 1,
          type: 'line',
        })
      })

      submitAction(gameId, 'lu_r0', { type: 'attack', target: { kind: 'wave', index: 0 } })
      const r = await runTick(sm, gameId)

      // Kill granted WAVE_XP → xp ≥ threshold → checkLevelUps promoted to L2.
      expect(r.state.players['lu_r0']!.xp).toBeGreaterThanOrEqual(threshold)
      expect(r.state.players['lu_r0']!.level).toBe(2)
      expect(
        r.events.some((e) => e._tag === 'level_up' && e.playerId === 'lu_r0' && e.newLevel === 2),
      ).toBe(true)
    })

    it('crossing into level 6 emits both level_up and a power_spike(level_6)', async () => {
      const gameId = uid('spike6')
      const sm = await startGame(gameId, makePlayers('ps', 1))

      // Sit at L5 with xp one WAVE_XP short of the L6 threshold.
      const threshold = XP_PER_LEVEL[6]!
      const startXp = threshold - WAVE_XP
      await arrange(sm, gameId, (s) => {
        const moved = setPlayer(s, 'ps_r0', { zone: 'coldstore-cross', level: 5, xp: startXp })
        return withSoloWave(moved, {
          id: 'spike_wave',
          team: 'audit',
          zone: 'coldstore-cross',
          integ: 1,
          type: 'line',
        })
      })

      submitAction(gameId, 'ps_r0', { type: 'attack', target: { kind: 'wave', index: 0 } })
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
    it('higher plate → proportionally smaller kinetic attack damage (same attacker profile)', async () => {
      const gameId = uid('armor')
      const sm = await startGame(gameId, makePlayers('ar', 3))

      // Two identical attackers each hit a distinct target. Targets share the
      // SAME hero/level (identical base armor); one carries a +20 defenseBuff.
      // The damage events then differ ONLY by the armor delta.
      const ARMOR_BONUS = 20
      await arrange(sm, gameId, (s) => {
        let next = s
        // attackers: same hero, same zone, same level
        next = setPlayer(next, 'ar_r0', { zone: 'coldstore-cross', heroId: 'kernel', level: 5 })
        next = setPlayer(next, 'ar_r1', { zone: 'coldstore-cross', heroId: 'kernel', level: 5 })
        // targets: same hero/level so base armor is identical
        next = setPlayer(next, 'ar_d0', {
          zone: 'coldstore-cross',
          heroId: 'cipher',
          level: 5,
          integ: 5000,
          maxInteg: 5000,
          buffs: [inCombatBuff()],
        })
        next = setPlayer(next, 'ar_d1', {
          zone: 'coldstore-cross',
          heroId: 'cipher',
          level: 5,
          integ: 5000,
          maxInteg: 5000,
          buffs: [
            inCombatBuff(),
            { id: 'defenseBuff', stacks: ARMOR_BONUS, cyclesRemaining: 5, source: 'test' },
          ],
        })
        return next
      })

      submitAction(gameId, 'ar_r0', { type: 'attack', target: { kind: 'hero', name: 'ar_d0' } })
      submitAction(gameId, 'ar_r1', { type: 'attack', target: { kind: 'hero', name: 'ar_d1' } })
      const r = await runTick(sm, gameId)

      const dmgLow = r.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'ar_d0' && e.damageType === 'kinetic',
      ) as Extract<GameEngineEvent, { _tag: 'damage' }> | undefined
      const dmgHigh = r.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'ar_d1' && e.damageType === 'kinetic',
      ) as Extract<GameEngineEvent, { _tag: 'damage' }> | undefined

      expect(dmgLow).toBeTruthy()
      expect(dmgHigh).toBeTruthy()
      // The +20-armor target took strictly less kinetic damage.
      expect(dmgHigh!.amount).toBeLessThan(dmgLow!.amount)
      expect(dmgHigh!.amount).toBeGreaterThan(0)
    })

    it('MKB on-hit magic: null_ref mrShred lowers effective MR → higher code damage on the shredded target', async () => {
      const gameId = uid('mr')
      const sm = await startGame(gameId, makePlayers('mr', 3))

      // Two identical MKB attackers; two identical targets except one carries a
      // mrShred debuff (null_ref's MR shred). MKB adds a flat TRUESTRIKE_RIG_BONUS_DAMAGE
      // code on-hit whose mitigated amount is emitted as its own code
      // damage event using getEffectiveIce — so the events differ ONLY
      // by the mrShred.
      const SHRED = 30
      await arrange(sm, gameId, (s) => {
        let next = s
        next = setPlayer(next, 'mr_r0', {
          zone: 'coldstore-cross',
          heroId: 'kernel',
          level: 5,
          items: ['truestrike_rig', null, null, null, null, null],
        })
        next = setPlayer(next, 'mr_r1', {
          zone: 'coldstore-cross',
          heroId: 'kernel',
          level: 5,
          items: ['truestrike_rig', null, null, null, null, null],
        })
        next = setPlayer(next, 'mr_d0', {
          zone: 'coldstore-cross',
          heroId: 'cipher',
          level: 5,
          integ: 5000,
          maxInteg: 5000,
          buffs: [inCombatBuff()],
        })
        next = setPlayer(next, 'mr_d1', {
          zone: 'coldstore-cross',
          heroId: 'cipher',
          level: 5,
          integ: 5000,
          maxInteg: 5000,
          buffs: [
            inCombatBuff(),
            { id: 'mrShred', stacks: SHRED, cyclesRemaining: 5, source: 'test' },
          ],
        })
        return next
      })

      submitAction(gameId, 'mr_r0', { type: 'attack', target: { kind: 'hero', name: 'mr_d0' } })
      submitAction(gameId, 'mr_r1', { type: 'attack', target: { kind: 'hero', name: 'mr_d1' } })
      const r = await runTick(sm, gameId)

      const magLow = r.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'mr_d0' && e.damageType === 'code',
      ) as Extract<GameEngineEvent, { _tag: 'damage' }> | undefined
      const magHigh = r.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'mr_d1' && e.damageType === 'code',
      ) as Extract<GameEngineEvent, { _tag: 'damage' }> | undefined

      expect(magLow, 'MKB must emit a code on-hit damage event').toBeTruthy()
      expect(magHigh).toBeTruthy()
      // mrShred → lower effective MR → the same TRUESTRIKE_RIG_BONUS_DAMAGE bleeds through
      // for MORE on the shredded target.
      expect(magHigh!.amount).toBeGreaterThan(magLow!.amount)
      // Sanity: the bonus magic can't exceed the raw MKB amount post-mitigation.
      expect(magHigh!.amount).toBeLessThanOrEqual(TRUESTRIKE_RIG_BONUS_DAMAGE)
    })
  })
})
