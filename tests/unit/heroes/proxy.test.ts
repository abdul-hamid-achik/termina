import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { resolveAbility, resolvePassive, applyBuff, hasBuff } from '~~/server/game/heroes/_base'
import { getTalentStatBonus } from '~~/server/game/engine/EffectiveStats'
import { TALENT_TREES } from '~~/shared/constants/talents'
// Register proxy hero
import '../../../server/game/heroes/proxy'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestProxy',
    team: 'chaff',
    heroId: 'proxy',
    zone: 'mid-river',
    integ: 580,
    maxInteg: 580,
    bw: 380,
    maxBw: 380,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 4,
    ice: 20,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
  if (player.team === 'audit' && !player.buffs.some((b) => b.id === 'breached')) {
    return {
      ...player,
      buffs: [...player.buffs, { id: 'breached', stacks: 1, cyclesRemaining: 99, source: 'test' }],
    }
  }
  return player
}

function makeAlly(overrides: Partial<PlayerState> = {}): PlayerState {
  return makePlayer({
    id: 'a1',
    name: 'Ally',
    team: 'chaff',
    heroId: 'echo',
    integ: 400,
    maxInteg: 550,
    ...overrides,
  })
}

function makeEnemy(overrides: Partial<PlayerState> = {}): PlayerState {
  return makePlayer({
    id: 'e1',
    name: 'Enemy',
    team: 'audit',
    heroId: 'echo',
    integ: 550,
    maxInteg: 550,
    bw: 280,
    maxBw: 280,
    plate: 3,
    ice: 15,
    ...overrides,
  })
}

function makeState(players: PlayerState[], overrides: Partial<GameState> = {}): GameState {
  const playerMap: Record<string, PlayerState> = {}
  for (const p of players) {
    playerMap[p.id] = p
  }
  return {
    cycle: 10,
    phase: 'playing',
    teams: {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0 },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0 },
    },
    players: playerMap,
    zones: {
      'mid-river': { id: 'mid-river', wards: [], waves: [] },
      'top-river': { id: 'top-river', wards: [], waves: [] },
      'mid-t1-chaff': { id: 'mid-t1-chaff', wards: [], waves: [] },
    },
    waves: [],
    ice: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Proxy Hero', () => {
  describe('Q: Packet Redirect (Magic Damage + Slow)', () => {
    it('deals code damage and slows target hero', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.integ).toBeLessThan(enemy.integ)
      expect(hasBuff(updatedEnemy, 'slow')).toBe(true)
      const slow = updatedEnemy.buffs.find((b) => b.id === 'slow')
      expect(slow!.stacks).toBe(25)
      expect(slow!.cyclesRemaining).toBe(2)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(380 - 70) // Level 1 Q costs 70
      expect(updated.cooldowns.q).toBe(8)
    })

    it('scales damage with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player1, enemy1])
      const state2 = makeState([player7, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'q', { kind: 'hero', name: 'e2' }),
      )

      const dmg1 = enemy1.integ - result1.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result2.state.players['e2']!.integ
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'top-river' })
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('W: Cache Shield (Ally Shield)', () => {
    it('applies shield buff to target ally', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const updatedAlly = result.state.players['a1']!
      expect(hasBuff(updatedAlly, 'shield')).toBe(true)
      const shield = updatedAlly.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(140) // Level 1 shield
      expect(shield!.cyclesRemaining).toBe(3)
    })

    it('scales shield with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const shield = result.state.players['a1']!.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(320) // Level 4 shield
    })

    it('can target self', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'self' }))

      expect(hasBuff(result.state.players['p1']!, 'shield')).toBe(true)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(380 - 90) // Level 1 W costs 90
      expect(updated.cooldowns.w).toBe(12)
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Load Balance (Zone Heal)', () => {
    it('heals self when alone in zone', () => {
      const player = makePlayer({ level: 1, integ: 400, maxInteg: 580 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      // Total heal 180, only self → full 180
      expect(result.state.players['p1']!.integ).toBe(580) // 400 + 180, capped at maxInteg
    })

    it('splits healing among all allies in zone', () => {
      const player = makePlayer({ level: 1, integ: 400, maxInteg: 580 })
      const ally = makeAlly({ integ: 300, maxInteg: 550 })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      // Total 180, split between 2 → 90 each
      expect(result.state.players['p1']!.integ).toBe(490) // 400 + 90
      expect(result.state.players['a1']!.integ).toBe(390) // 300 + 90
    })

    it('does not heal above maxInteg', () => {
      const player = makePlayer({ level: 7, integ: 570, maxInteg: 580 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(result.state.players['p1']!.integ).toBe(580)
    })

    it('does not heal allies in different zone', () => {
      const player = makePlayer({ level: 1, integ: 400, maxInteg: 580 })
      const ally = makeAlly({ integ: 300, zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      // Only self → full 180
      expect(result.state.players['p1']!.integ).toBe(580) // 400 + 180 capped
      expect(result.state.players['a1']!.integ).toBe(300) // unchanged
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(380 - 100) // Level 1 E costs 100
      expect(updated.cooldowns.e).toBe(10)
    })

    it('fails with insufficient BW', () => {
      const player = makePlayer({ bw: 10 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Reverse Proxy (Swap + Invulnerability)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, bw: 500 })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('swaps zones between caster and ally', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }))

      expect(result.state.players['p1']!.zone).toBe('top-river')
      expect(result.state.players['a1']!.zone).toBe('mid-river')
    })

    it('grants invulnerability to both for 1 tick', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }))

      expect(hasBuff(result.state.players['p1']!, 'invulnerable')).toBe(true)
      expect(hasBuff(result.state.players['a1']!, 'invulnerable')).toBe(true)
      const buff = result.state.players['p1']!.buffs.find((b) => b.id === 'invulnerable')
      expect(buff!.cyclesRemaining).toBe(1)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makeAlly({ zone: 'top-river' })
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 200) // R1 costs 200
      expect(updated.cooldowns.r).toBe(50)
    })

    it('fails when targeting an enemy', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('requires hero target', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Passive: Middleman', () => {
    it('applies middleman buff if missing', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(hasBuff(updated.players['p1']!, 'middleman')).toBe(true)
      const buff = updated.players['p1']!.buffs.find((b) => b.id === 'middleman')
      expect(buff!.stacks).toBe(12) // 12%
    })

    it('does not duplicate buff if already present', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'middleman',
        stacks: 12,
        cyclesRemaining: 9999,
        source: 'p1',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'tick_end',
        payload: {},
      })

      const middlemanBuffs = updated.players['p1']!.buffs.filter((b) => b.id === 'middleman')
      expect(middlemanBuffs.length).toBe(1)
    })
  })

  describe('Stun/Silence blocking', () => {
    it('prevents casting when stunned', () => {
      const player = makePlayer({
        buffs: [{ id: 'stun', stacks: 1, cyclesRemaining: 1, source: 'enemy' }],
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('prevents casting when silenced', () => {
      const player = makePlayer({
        buffs: [{ id: 'silence', stacks: 1, cyclesRemaining: 2, source: 'enemy' }],
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })
  })

  describe('Talents (engine-applied — formerly dead "Illusion" specialEffect no-ops)', () => {
    it('proxy_15_left reduces Packet Redirect cooldown by 2 (was the dead illusion_plus_2 no-op)', () => {
      const player = makePlayer({
        talents: { tier10: null, tier15: 'proxy_15_left', tier20: null, tier25: null },
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      // Q_COOLDOWN (8) − 2
      expect(result.state.players['p1']!.cooldowns.q).toBe(6)
    })

    it('proxy_25_left reduces Reverse Proxy cooldown by 12 (was the dead triple_illusion no-op)', () => {
      const player = makePlayer({
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'proxy_25_left' },
      })
      const ally = makeAlly()
      const state = makeState([player, ally])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'a1' }))

      // R_COOLDOWN (50) − 12
      expect(result.state.players['p1']!.cooldowns.r).toBe(38)
    })

    it('proxy_25_right grants +250 max BW via getTalentStatBonus (was the dead invisible_illusions no-op)', () => {
      const player = makePlayer({
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'proxy_25_right' },
      })
      expect(getTalentStatBonus(player, 'bw')).toBe(250)
    })

    it('no proxy talent is a dead specialEffect no-op anymore', () => {
      for (const t of Object.values(TALENT_TREES.proxy.tiers).flat()) {
        expect(t.type).not.toBe('special')
        expect(t.type).not.toBe('ability_boost')
        expect((t as { specialEffect?: string }).specialEffect).toBeUndefined()
      }
    })
  })

  describe('Passive: Middleman (damage redirect — formerly a dead marker)', () => {
    it('soaks 12% of an in-zone ally’s damage: ally healed back, Proxy loses it', () => {
      const proxy = makePlayer({
        id: 'p1',
        team: 'chaff',
        zone: 'mid-river',
        integ: 500,
        maxInteg: 580,
      })
      const ally = makeAlly({ id: 'a1', zone: 'mid-river', integ: 400, maxInteg: 600 }) // just took a hit
      const state = makeState([proxy, ally])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'damage_taken',
        payload: { targetId: 'a1', attackerId: 'e1', sourceId: 'e1', damage: 100, amount: 100 },
      })

      expect(updated.players['a1']!.integ).toBe(412) // 400 + round(100 * 0.12) = 12
      expect(updated.players['p1']!.integ).toBe(488) // 500 − 12 soaked
    })

    it('does not redirect Proxy’s own damage', () => {
      const proxy = makePlayer({
        id: 'p1',
        team: 'chaff',
        zone: 'mid-river',
        integ: 500,
        maxInteg: 580,
      })
      const state = makeState([proxy])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'damage_taken',
        payload: { targetId: 'p1', attackerId: 'e1', sourceId: 'e1', damage: 100, amount: 100 },
      })

      expect(updated.players['p1']!.integ).toBe(500) // unchanged
    })

    it('does not redirect an ally in a different zone', () => {
      const proxy = makePlayer({
        id: 'p1',
        team: 'chaff',
        zone: 'mid-river',
        integ: 500,
        maxInteg: 580,
      })
      const ally = makeAlly({ id: 'a1', zone: 'top-river', integ: 400, maxInteg: 600 })
      const state = makeState([proxy, ally])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'damage_taken',
        payload: { targetId: 'a1', attackerId: 'e1', sourceId: 'e1', damage: 100, amount: 100 },
      })

      expect(updated.players['a1']!.integ).toBe(400) // unchanged
      expect(updated.players['p1']!.integ).toBe(500) // Proxy didn't soak
    })
  })
})
