import { describe, it, expect } from 'vitest'
import {
  calculateBuybackCost,
  canBuyback,
  buyback,
  updateBuybackCost,
} from '../../../server/game/engine/BuybackSystem'
import {
  BUYBACK_BASE_COST,
  BUYBACK_COST_PER_LEVEL,
  BUYBACK_COOLDOWN_TICKS,
} from '../../../shared/constants/balance'
import type { GameState, PlayerState } from '../../../shared/types/game'

function makePlayer(o: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'P1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 0,
    maxHp: 600,
    mp: 0,
    maxMp: 300,
    level: 6,
    xp: 0,
    gold: 2000,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: false,
    respawnTick: 100,
    defense: 3,
    magicResist: 15,
    kills: 0,
    deaths: 2,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    ...o,
  } as PlayerState
}

function makeState(player: PlayerState, tick = 50): GameState {
  return { tick, players: { [player.id]: player } } as GameState
}

describe('BuybackSystem', () => {
  describe('calculateBuybackCost', () => {
    it('scales with base cost + per-level + a small death penalty', () => {
      const p = makePlayer({ level: 6, deaths: 2 })
      expect(calculateBuybackCost(p)).toBe(BUYBACK_BASE_COST + 6 * BUYBACK_COST_PER_LEVEL + 2 * 10)
    })
  })

  describe('canBuyback', () => {
    it('rejects a living player', () => {
      expect(canBuyback(makeState(makePlayer({ alive: true })), 'p1').can).toBe(false)
    })

    it('rejects while the buyback cooldown is still running', () => {
      const p = makePlayer({ alive: false, gold: 99999, buybackCooldown: 100 })
      expect(canBuyback(makeState(p, 50), 'p1').can).toBe(false)
    })

    it('rejects without enough gold', () => {
      const res = canBuyback(makeState(makePlayer({ alive: false, gold: 0 })), 'p1')
      expect(res.can).toBe(false)
      expect(res.reason).toMatch(/gold/i)
    })

    it('allows a dead, funded, off-cooldown player', () => {
      expect(canBuyback(makeState(makePlayer({ alive: false, gold: 99999 })), 'p1').can).toBe(true)
    })

    it('rejects an unknown player', () => {
      expect(canBuyback(makeState(makePlayer()), 'ghost').can).toBe(false)
    })
  })

  describe('buyback (execution)', () => {
    it('instantly respawns at full HP/MP, deducts gold, sets cooldown, and sends to the fountain', () => {
      const p = makePlayer({ alive: false, gold: 99999, hp: 0, mp: 0, team: 'radiant' })
      const res = buyback(makeState(p, 50), 'p1')

      expect(res.success).toBe(true)
      const np = res.newState!.players['p1']!
      expect(np.alive).toBe(true)
      expect(np.hp).toBe(np.maxHp)
      expect(np.mp).toBe(np.maxMp)
      expect(np.respawnTick).toBeNull()
      expect(np.gold).toBe(99999 - calculateBuybackCost(p))
      expect(np.buybackCooldown).toBe(50 + BUYBACK_COOLDOWN_TICKS)
      expect(np.zone).toBe('radiant-fountain')
    })

    it('sends a dire buyback to the dire fountain', () => {
      const p = makePlayer({ alive: false, gold: 99999, team: 'dire' })
      expect(buyback(makeState(p), 'p1').newState!.players['p1']!.zone).toBe('dire-fountain')
    })

    it('fails for a living player and leaves no state', () => {
      const res = buyback(makeState(makePlayer({ alive: true })), 'p1')
      expect(res.success).toBe(false)
      expect(res.newState).toBeUndefined()
    })

    it('fails for an unknown player', () => {
      expect(buyback(makeState(makePlayer()), 'ghost').success).toBe(false)
    })
  })

  describe('updateBuybackCost', () => {
    it('stamps the current buyback cost onto the player', () => {
      const p = makePlayer({ level: 10, deaths: 3 })
      const s = updateBuybackCost(makeState(p), 'p1')
      expect(s.players['p1']!.buybackCost).toBe(calculateBuybackCost(p))
    })

    it('no-ops for an unknown player', () => {
      const s = makeState(makePlayer())
      expect(updateBuybackCost(s, 'ghost')).toBe(s)
    })
  })
})
