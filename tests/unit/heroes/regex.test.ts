import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { resolveAbility } from '~~/server/game/heroes/_base'
import { TALENT_TREES } from '~~/shared/constants/talents'
import { hasTalentCastEffect } from '~~/server/game/engine/EffectiveStats'
import '../../../server/game/heroes/regex'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const player = {
    id: 'p1',
    name: 'TestRegex',
    team: 'chaff',
    heroId: 'regex',
    zone: 'coldstore-cross',
    integ: 450,
    maxInteg: 450,
    bw: 400,
    maxBw: 400,
    level: 7,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 1,
    ice: 18,
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
    },
    waves: [],
    neutrals: [],
    ice: [],
    caches: [],
    tenant: { alive: false, integ: 0, maxInteg: 0, deathCycle: null },
    backup: null,
    events: [],
    ...overrides,
  }
}

describe('Regex Hero', () => {
  describe('Q: Match', () => {
    it('deals code damage to target hero', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      expect(result.state.players['e1']!.integ).toBeLessThan(enemy.integ)
      expect(result.events[0]!.type).toBe('ability_cast')
    })

    it('applies magic vulnerability debuff', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const debuff = result.state.players['e1']!.buffs.find((b) => b.id === 'magicVulnerability')
      expect(debuff).toBeDefined()
      expect(debuff!.stacks).toBe(15)
      expect(debuff!.cyclesRemaining).toBe(3)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(400 - 60)
      expect(updated.cooldowns.q).toBe(5)
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

    it('scales cooldown with level', () => {
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

      expect(result1.state.players['p1']!.cooldowns.q).toBe(5)
      expect(result2.state.players['p1']!.cooldowns.q).toBe(2)
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
  })

  describe('W: Capture Group', () => {
    it('roots target for 2 ticks', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const root = result.state.players['e1']!.buffs.find((b) => b.id === 'root')
      expect(root).toBeDefined()
      expect(root!.cyclesRemaining).toBe(2)
    })

    it('applies DoT to target', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const dot = result.state.players['e1']!.buffs.find((b) => b.id === 'dot_magical')
      expect(dot).toBeDefined()
      expect(dot!.stacks).toBe(30)
      expect(dot!.cyclesRemaining).toBe(3)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(400 - 90)
      expect(updated.cooldowns.w).toBe(10)
    })

    it('scales DoT damage with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player1, enemy1])
      const state2 = makeState([player7, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'w', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'w', { kind: 'hero', name: 'e2' }),
      )

      const dot1 = result1.state.players['e1']!.buffs.find((b) => b.id === 'dot_magical')
      const dot2 = result2.state.players['e2']!.buffs.find((b) => b.id === 'dot_magical')
      expect(dot2!.stacks).toBeGreaterThan(dot1!.stacks)
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'w'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('E: Substitution', () => {
    it('swaps positions with target', () => {
      const player = makePlayer({ zone: 'coldstore-cross' })
      const enemy = makeEnemy({ zone: 'seawall-cross' })
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      expect(result.state.players['p1']!.zone).toBe('seawall-cross')
      expect(result.state.players['e1']!.zone).toBe('coldstore-cross')
    })

    it('stuns both caster and target', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const casterStun = result.state.players['p1']!.buffs.find((b) => b.id === 'stun')
      const targetStun = result.state.players['e1']!.buffs.find((b) => b.id === 'stun')
      expect(casterStun).toBeDefined()
      expect(targetStun).toBeDefined()
      // raw 2 = one gated action: a cast-applied disable is reaped same-tick.
      expect(casterStun!.cyclesRemaining).toBe(2)
      expect(targetStun!.cyclesRemaining).toBe(2)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(400 - 100)
      expect(updated.cooldowns.e).toBe(15)
    })

    it('scales cooldown with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player1, enemy1])
      const state2 = makeState([player7, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'e', { kind: 'hero', name: 'e2' }),
      )

      expect(result1.state.players['p1']!.cooldowns.e).toBe(15)
      expect(result2.state.players['p1']!.cooldowns.e).toBe(12)
    })

    it('works on targets in different zones', () => {
      const player = makePlayer({ zone: 'coldstore-cross' })
      const enemy = makeEnemy({ zone: 'seawall-cross' })
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      expect(result.state.players['p1']!.zone).toBe('seawall-cross')
      expect(result.state.players['e1']!.zone).toBe('coldstore-cross')
    })

    it('requires hero target', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'e'))
      expect(result._tag).toBe('Failure')
    })
  })

  describe('R: Catastrophic Backtracking', () => {
    it('requires level 6+', () => {
      const player = makePlayer({ level: 5, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      expect(result._tag).toBe('Failure')
    })

    it('deals damage based on missing BW', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy({ bw: 100, maxBw: 280 })
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }))

      const _missingMana = 280 - 100
      const actualDamage = enemy.integ - result.state.players['e1']!.integ
      expect(actualDamage).toBeGreaterThan(0)
    })

    it('silences target for 2 ticks', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }))

      const silence = result.state.players['e1']!.buffs.find((b) => b.id === 'silence')
      expect(silence).toBeDefined()
      expect(silence!.cyclesRemaining).toBe(2)
    })

    it('deducts BW and sets cooldown', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }))

      const updated = result.state.players['p1']!
      expect(updated.bw).toBe(500 - 300)
      expect(updated.cooldowns.r).toBe(60)
    })

    it('scales damage per missing BW with level', () => {
      const player6 = makePlayer({ level: 6, bw: 500 })
      const player18 = makePlayer({ level: 18, bw: 500 })
      const enemy1 = makeEnemy({ bw: 100, maxBw: 280, integ: 1000, maxInteg: 1000 })
      const enemy2 = makeEnemy({
        id: 'e2',
        name: 'Enemy2',
        bw: 100,
        maxBw: 280,
        integ: 1000,
        maxInteg: 1000,
      })

      const state1 = makeState([player6, enemy1])
      const state2 = makeState([player18, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'r', { kind: 'hero', name: 'e2' }),
      )

      const dmg1 = enemy1.integ - result1.state.players['e1']!.integ
      const dmg2 = enemy2.integ - result2.state.players['e2']!.integ
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('scales cooldown with level', () => {
      const player6 = makePlayer({ level: 6, bw: 500 })
      const player18 = makePlayer({ level: 18, bw: 500 })
      const enemy1 = makeEnemy()
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })

      const state1 = makeState([player6, enemy1])
      const state2 = makeState([player18, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'r', { kind: 'hero', name: 'e2' }),
      )

      expect(result1.state.players['p1']!.cooldowns.r).toBe(60)
      expect(result2.state.players['p1']!.cooldowns.r).toBe(50)
    })

    it('requires hero target', () => {
      const player = makePlayer({ level: 6, bw: 500 })
      const state = makeState([player])

      const result = Effect.runSyncExit(resolveAbility(state, 'p1', 'r'))
      expect(result._tag).toBe('Failure')
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

  describe('Talents (engine-applied — formerly dead specialEffect no-ops)', () => {
    it('regex_20_left reduces Capture Group cooldown by 2 (was the dead slow_plus_50 no-op)', () => {
      const player = makePlayer({
        level: 1,
        talents: { tier10: null, tier15: null, tier20: 'regex_20_left', tier25: null },
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w', { kind: 'hero', name: 'e1' }))

      // W_COOLDOWN[0] (10) − 2
      expect(result.state.players['p1']!.cooldowns.w).toBe(8)
    })

    it('regex_25_right grants the global-ultimate exotic (Global Backtracking)', () => {
      const player = makePlayer({
        level: 6,
        bw: 500,
        talents: { tier10: null, tier15: null, tier20: null, tier25: 'regex_25_right' },
      })
      expect(hasTalentCastEffect(player, 'global_ultimate', 'r')).toBe(true)
    })

    it('regex_25_left boosts Backtracking damage (was the dead global_ultimate no-op)', () => {
      const enemyOpts = { bw: 100, maxBw: 280, integ: 1000, maxInteg: 1000 }

      const boosted = Effect.runSync(
        resolveAbility(
          makeState([
            makePlayer({
              level: 6,
              bw: 500,
              talents: { tier10: null, tier15: null, tier20: null, tier25: 'regex_25_left' },
            }),
            makeEnemy(enemyOpts),
          ]),
          'p1',
          'r',
          { kind: 'hero', name: 'e1' },
        ),
      )
      const plain = Effect.runSync(
        resolveAbility(
          makeState([makePlayer({ level: 6, bw: 500 }), makeEnemy(enemyOpts)]),
          'p1',
          'r',
          { kind: 'hero', name: 'e1' },
        ),
      )

      const dmgBoosted = 1000 - boosted.state.players['e1']!.integ
      const dmgPlain = 1000 - plain.state.players['e1']!.integ
      expect(dmgPlain).toBeGreaterThan(0)
      expect(dmgBoosted).toBeGreaterThan(dmgPlain)
    })

    it('no regex talent is a dead specialEffect no-op anymore', () => {
      for (const t of Object.values(TALENT_TREES.regex.tiers).flat()) {
        expect(t.type).not.toBe('ability_boost')
        // 'special' talents are valid only when wired via a castEffect.
        if (t.type === 'special' || (t as { specialEffect?: string }).specialEffect) {
          expect(
            (t as { castEffect?: string }).castEffect,
            `regex ${t.id} is special without a wired castEffect (dead no-op)`,
          ).toBeDefined()
        }
      }
    })
  })
})
