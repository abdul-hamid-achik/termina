import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { resolveAbility, resolvePassive, applyBuff, hasBuff } from '~~/server/game/heroes/_base'
import { getTalentStatBonus } from '~~/server/game/engine/EffectiveStats'
import { TALENT_TREES } from '~~/shared/constants/talents'
// Register kernel hero
import '../../../server/game/heroes/kernel'

// ── Test Helpers ──────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestKernel',
    team: 'chaff',
    heroId: 'kernel',
    zone: 'coldstore-cross',
    integ: 750,
    maxInteg: 750,
    bw: 250,
    maxBw: 250,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 8,
    ice: 25,
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
      'coldstore-cross': { id: 'coldstore-cross', wards: [] },
      'seawall-cross': { id: 'seawall-cross', wards: [] },
      'cache-seawall': { id: 'cache-seawall', wards: [] },
    },
    waves: [],
    ice: [],
    events: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Kernel Hero', () => {
  describe('Q: Interrupt (Stun)', () => {
    it('stuns target hero for 1 tick', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(hasBuff(updatedEnemy, 'stun')).toBe(true)
      const stun = updatedEnemy.buffs.find((b) => b.id === 'stun')
      // raw 2 = one gated action: a cast-applied disable is reaped same-tick.
      expect(stun!.cyclesRemaining).toBe(2)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(250 - 80) // Level 1 Q costs 80
      expect(updated.cooldowns.q).toBe(10)
    })

    it('scales BW cost with level', () => {
      const player = makePlayer({ level: 7 }) // Q level 4
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(250 - 110) // Level 4 Q costs 110
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'q'))
      expect(result._tag).toBe('Failure')
    })

    it('fails when target is in different zone', () => {
      const player = makePlayer()
      const enemy = makeEnemy({ zone: 'seawall-cross' })
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

  describe('W: Buffer (Shield)', () => {
    it('applies shield buff to self', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(hasBuff(updated, 'shield')).toBe(true)
      const shield = updated.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(150) // Level 1 shield = 150
      expect(shield!.cyclesRemaining).toBe(3)
    })

    it('scales shield amount with level', () => {
      const player = makePlayer({ level: 7 }) // W level 4
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const shield = result.state.players['p1']!.buffs.find((b) => b.id === 'shield')
      expect(shield!.stacks).toBe(450) // Level 4 shield = 450
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(250 - 100) // Level 1 W costs 100
      expect(updated.cooldowns.w).toBe(14)
    })
  })

  describe('E: Core Dump (Taunt)', () => {
    it('taunts all enemies in zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(hasBuff(result.state.players['e1']!, 'taunt')).toBe(true)
      expect(hasBuff(result.state.players['e2']!, 'taunt')).toBe(true)
      const taunt = result.state.players['e1']!.buffs.find((b) => b.id === 'taunt')
      expect(taunt!.cyclesRemaining).toBe(2)
    })

    it('does not affect allies', () => {
      const player = makePlayer({ level: 1 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'chaff' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      expect(hasBuff(result.state.players['a1']!, 'taunt')).toBe(false)
      expect(hasBuff(result.state.players['e1']!, 'taunt')).toBe(true)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(250 - 120) // Level 1 E costs 120
      expect(updated.cooldowns.e).toBe(18)
    })
  })

  describe('R: Panic (Displace)', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
    })

    it('displaces enemies to adjacent zones and applies feared buff', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updatedEnemy = result.state.players['e1']!
      // Enemy should have moved to an adjacent zone (random, but not coldstore-cross)
      expect(updatedEnemy.zone).not.toBe('coldstore-cross')
      expect(hasBuff(updatedEnemy, 'feared')).toBe(true)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 200) // Level 1 R costs 200
      expect(updated.cooldowns.r).toBe(50)
    })

    it('does not displace allies', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'chaff' })
      const enemy = makeEnemy()
      const state = makeState([player, ally, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      expect(result.state.players['a1']!.zone).toBe('coldstore-cross')
    })
  })

  describe('Passive: Hardened', () => {
    it('applies hardened buff on tick_end if missing', () => {
      const player = makePlayer()
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'tick_end',
        payload: {},
      })

      expect(hasBuff(updated.players['p1']!, 'hardened')).toBe(true)
    })

    it('does not duplicate buff if already present', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'hardened',
        stacks: 1,
        cyclesRemaining: 9999,
        source: 'p1',
      })
      const state = makeState([player])

      const updated = resolvePassive(state, 'p1', {
        cycle: 10,
        type: 'tick_end',
        payload: {},
      })

      const hardenedBuffs = updated.players['p1']!.buffs.filter((b) => b.id === 'hardened')
      expect(hardenedBuffs.length).toBe(1)
    })
  })

  describe('Talents (engine-applied — formerly dead specialEffect / damage-on-a-stun no-ops)', () => {
    it('kernel_25_left reduces Panic cooldown by 10 (was the dead immunity_plus_2 no-op)', () => {
      const player = makePlayer({
        level: 7,
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'kernel_25_left' },
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r'))

      // R_COOLDOWN (50) − 10
      expect(result.state.players['p1']!.cooldowns.r).toBe(40)
    })

    it('kernel_20_left reduces Core Dump cooldown by 3 (was damage_boost on a no-damage stun — a silent no-op)', () => {
      const player = makePlayer({
        level: 7,
        talents: { tier10: null, tier15: null, tier20: 'kernel_20_left', tier25: null },
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e'))

      // E_COOLDOWN (18) − 3
      expect(result.state.players['p1']!.cooldowns.e).toBe(15)
    })

    it('kernel_15_left refunds 40% of Interrupt BW cost (was the dead root_duration_plus_1 no-op)', () => {
      const player = makePlayer({
        level: 1,
        bw: 250,
        talents: { tier10: null, tier15: 'kernel_15_left', tier20: null, tier25: null },
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      // Q_MANA[0] = 80 spent, then round(80 * 40%) = 32 refunded → 250 − 80 + 32
      expect(result.state.players['p1']!.bw).toBe(202)
    })

    it('kernel_25_right grants +20 iceance via getTalentStatBonus (was the dead double_root no-op)', () => {
      const player = makePlayer({
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'kernel_25_right' },
      })
      expect(getTalentStatBonus(player, 'ice')).toBe(20)
    })

    it('no kernel talent is a dead specialEffect no-op anymore', () => {
      for (const t of Object.values(TALENT_TREES.kernel.tiers).flat()) {
        expect(t.type).not.toBe('special')
        expect(t.type).not.toBe('ability_boost')
        expect((t as { specialEffect?: string }).specialEffect).toBeUndefined()
      }
    })
  })
})
