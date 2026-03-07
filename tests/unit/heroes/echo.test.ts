import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { resolveAbility, getAbilityLevel, applyBuff } from '../../../server/game/heroes/_base'
import { getResonanceMultiplier } from '../../../server/game/heroes/echo'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 550,
    maxHp: 550,
    mp: 280,
    maxMp: 280,
    level: 7,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 3,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function makeEnemy(overrides: Partial<PlayerState> = {}): PlayerState {
  return makePlayer({
    id: 'e1',
    name: 'Enemy',
    team: 'dire',
    heroId: 'echo',
    ...overrides,
  })
}

function makeState(players: PlayerState[], overrides: Partial<GameState> = {}): GameState {
  const playerMap: Record<string, PlayerState> = {}
  for (const p of players) {
    playerMap[p.id] = p
  }
  return {
    tick: 10,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: playerMap,
    zones: {
      'mid-river': { id: 'mid-river', wards: [], creeps: [] },
      'top-river': { id: 'top-river', wards: [], creeps: [] },
    },
    creeps: [],
    neutrals: [],
    towers: [],
    runes: [],
    roshan: { alive: false, hp: 0, maxHp: 0, deathTick: null },
    aegis: null,
    events: [],
    ...overrides,
  }
}

describe('Echo Hero', () => {
  describe('getAbilityLevel', () => {
    it('returns correct Q/W/E levels at various player levels', () => {
      expect(getAbilityLevel(1, 'q')).toBe(1)
      expect(getAbilityLevel(2, 'q')).toBe(1)
      expect(getAbilityLevel(3, 'q')).toBe(2)
      expect(getAbilityLevel(5, 'q')).toBe(3)
      expect(getAbilityLevel(7, 'q')).toBe(4)
    })

    it('returns correct R levels', () => {
      expect(getAbilityLevel(5, 'r')).toBe(0)
      expect(getAbilityLevel(6, 'r')).toBe(1)
      expect(getAbilityLevel(12, 'r')).toBe(2)
      expect(getAbilityLevel(18, 'r')).toBe(3)
    })
  })

  describe('Q: Resonance', () => {
    it('deals physical damage to target hero in same zone', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.hp).toBeLessThan(enemy.hp)
      expect(result.events.length).toBeGreaterThan(0)
      expect(result.events[0]!.type).toBe('ability_cast')
    })

    it('deducts mana and sets cooldown', () => {
      const player = makePlayer({ level: 1 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      const updatedPlayer = result.state.players['p1']!
      expect(updatedPlayer.mp).toBe(280 - 40)
      expect(updatedPlayer.cooldowns.q).toBe(6)
    })

    it('bounces to nearby enemy for 50% damage', () => {
      const player = makePlayer({ level: 1 })
      const enemy1 = makeEnemy({ id: 'e1', name: 'Enemy1' })
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2' })
      const state = makeState([player, enemy1, enemy2])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }))

      expect(result.state.players['e2']!.hp).toBeLessThan(enemy2.hp)
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

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
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

      expect(result1.state.players['p1']!.cooldowns.q).toBe(6)
      expect(result2.state.players['p1']!.cooldowns.q).toBe(3)
    })

    it('fails with InsufficientManaError when no mana', () => {
      const player = makePlayer({ mp: 10 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

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
  })

  describe('W: Phase Shift', () => {
    it('applies phaseShift buff to self', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.buffs.some((b) => b.id === 'phaseShift')).toBe(true)
    })

    it('applies move speed buff', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const buff = result.state.players['p1']!.buffs.find((b) => b.id === 'moveSpeed')
      expect(buff).toBeDefined()
      expect(buff!.stacks).toBe(50)
      expect(buff!.ticksRemaining).toBe(2)
    })

    it('phaseShift buff has 1 tick duration', () => {
      const player = makePlayer()
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const buff = result.state.players['p1']!.buffs.find((b) => b.id === 'phaseShift')
      expect(buff?.ticksRemaining).toBe(1)
    })

    it('scales mana cost with level', () => {
      const player = makePlayer({ level: 7 })
      const state = makeState([player])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'w'))

      const updated = result.state.players['p1']!
      expect(updated.mp).toBe(280 - 80)
    })

    it('scales cooldown with level', () => {
      const player1 = makePlayer({ level: 1 })
      const player7 = makePlayer({ level: 7 })

      const state1 = makeState([player1])
      const state2 = makeState([player7])

      const result1 = Effect.runSync(resolveAbility(state1, 'p1', 'w'))
      const result2 = Effect.runSync(resolveAbility(state2, 'p1', 'w'))

      expect(result1.state.players['p1']!.cooldowns.w).toBe(12)
      expect(result2.state.players['p1']!.cooldowns.w).toBe(9)
    })
  })

  describe('E: Feedback Loop', () => {
    it('fails when no feedback stacks to consume', () => {
      const player = makePlayer()
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }),
      )

      expect(result._tag).toBe('Failure')
    })

    it('consumes stacks and deals burst damage', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'feedbackLoop',
        stacks: 50,
        ticksRemaining: 999,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const updatedEnemy = result.state.players['e1']!
      expect(updatedEnemy.hp).toBeLessThan(enemy.hp)
      expect(result.events[0]!.payload.stacksConsumed).toBe(50)
    })

    it('deals 2x stack value as damage', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'feedbackLoop',
        stacks: 100,
        ticksRemaining: 999,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const damage = enemy.hp - result.state.players['e1']!.hp
      expect(damage).toBeGreaterThan(180)
    })

    it('resets stacks after consumption', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'feedbackLoop',
        stacks: 50,
        ticksRemaining: 999,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      const updatedPlayer = result.state.players['p1']!
      const stacks = updatedPlayer.buffs.find((b) => b.id === 'feedbackLoop')?.stacks ?? 0
      expect(stacks).toBe(0)
    })

    it('sets cooldown based on level', () => {
      let player = makePlayer({ level: 7 })
      player = applyBuff(player, {
        id: 'feedbackLoop',
        stacks: 50,
        ticksRemaining: 999,
        source: 'p1',
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'e', { kind: 'hero', name: 'e1' }))

      expect(result.state.players['p1']!.cooldowns.e).toBe(5)
    })
  })

  describe('R: Cascade', () => {
    it('requires level 6+ to cast', () => {
      const player = makePlayer({ level: 5 })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )

      expect(result._tag).toBe('Failure')
    })

    it('deals 6 hits of physical damage to target', () => {
      const player = makePlayer({ level: 6, mp: 500 })
      const enemy = makeEnemy({ hp: 1000, maxHp: 1000 })
      const state = makeState([player, enemy])

      const result = Effect.runSync(resolveAbility(state, 'p1', 'r', { kind: 'hero', name: 'e1' }))

      expect(result.state.players['e1']!.hp).toBeLessThan(enemy.hp)
      expect(result.events[0]!.payload.hits).toBe(6)
    })

    it('scales damage with R level', () => {
      const player6 = makePlayer({ level: 6, mp: 500 })
      const player18 = makePlayer({ level: 18, mp: 500 })
      const enemy1 = makeEnemy({ hp: 2000, maxHp: 2000 })
      const enemy2 = makeEnemy({ id: 'e2', name: 'Enemy2', hp: 2000, maxHp: 2000 })

      const state1 = makeState([player6, enemy1])
      const state2 = makeState([player18, enemy2])

      const result1 = Effect.runSync(
        resolveAbility(state1, 'p1', 'r', { kind: 'hero', name: 'e1' }),
      )
      const result2 = Effect.runSync(
        resolveAbility(state2, 'p1', 'r', { kind: 'hero', name: 'e2' }),
      )

      const dmg1 = enemy1.hp - result1.state.players['e1']!.hp
      const dmg2 = enemy2.hp - result2.state.players['e2']!.hp
      expect(dmg2).toBeGreaterThan(dmg1)
    })

    it('scales cooldown with level', () => {
      const player6 = makePlayer({ level: 6, mp: 500 })
      const player18 = makePlayer({ level: 18, mp: 500 })
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

      expect(result1.state.players['p1']!.cooldowns.r).toBe(50)
      expect(result2.state.players['p1']!.cooldowns.r).toBe(40)
    })
  })

  describe('Passive: Resonance', () => {
    it('tracks stacks via getResonanceMultiplier', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'resonance',
        stacks: 3,
        ticksRemaining: 30,
        source: 'p1',
      })

      const multiplier = getResonanceMultiplier(player)
      expect(multiplier).toBeCloseTo(1.24)
    })

    it('starts at 1x with no stacks', () => {
      const player = makePlayer()
      expect(getResonanceMultiplier(player)).toBe(1)
    })

    it('caps at 5 stacks', () => {
      let player = makePlayer()
      player = applyBuff(player, {
        id: 'resonance',
        stacks: 5,
        ticksRemaining: 30,
        source: 'p1',
      })

      expect(getResonanceMultiplier(player)).toBeCloseTo(1.4)
    })
  })

  describe('Stun/Silence blocking', () => {
    it('prevents casting when stunned', () => {
      const player = makePlayer({
        buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 1, source: 'enemy' }],
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
        buffs: [{ id: 'silence', stacks: 1, ticksRemaining: 2, source: 'enemy' }],
      })
      const enemy = makeEnemy()
      const state = makeState([player, enemy])

      const result = Effect.runSyncExit(
        resolveAbility(state, 'p1', 'q', { kind: 'hero', name: 'e1' }),
      )

      expect(result._tag).toBe('Failure')
    })
  })
})
