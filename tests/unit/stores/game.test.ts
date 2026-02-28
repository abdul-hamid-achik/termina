import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../../app/stores/game'
import type { TickStateMessage, PlayerEndStats } from '../../../shared/types/protocol'
import type { PlayerState, GameEvent, TeamState, ZoneRuntimeState } from '../../../shared/types/game'

// ── Helpers ───────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
    hp: 500,
    maxHp: 550,
    mp: 200,
    maxMp: 280,
    level: 3,
    xp: 150,
    gold: 300,
    items: ['boots', null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 15,
    kills: 2,
    deaths: 1,
    assists: 3,
    damageDealt: 0,
    towerDamageDealt: 0,
    ...overrides,
  }
}

function makeTeams(): { radiant: TeamState; dire: TeamState } {
  return {
    radiant: { id: 'radiant', kills: 5, towerKills: 1, gold: 5000 },
    dire: { id: 'dire', kills: 3, towerKills: 0, gold: 4200 },
  }
}

function makeZone(id: string): ZoneRuntimeState {
  return { id, wards: [], creeps: [] }
}

function makeTickMessage(overrides: Partial<{
  tick: number
  phase: string
  players: Record<string, PlayerState>
  zones: Record<string, ZoneRuntimeState>
  teams: { radiant: TeamState; dire: TeamState }
}> = {}): TickStateMessage {
  const players = overrides.players ?? { p1: makePlayer() }
  return {
    type: 'tick_state',
    tick: overrides.tick ?? 10,
    state: {
      phase: overrides.phase ?? 'playing',
      players,
      zones: overrides.zones ?? { 'mid-t1-rad': makeZone('mid-t1-rad') },
      teams: overrides.teams ?? makeTeams(),
    } as TickStateMessage['state'],
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Game Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('initial state', () => {
    it('has correct defaults', () => {
      const store = useGameStore()

      expect(store.gameId).toBeNull()
      expect(store.playerId).toBeNull()
      expect(store.phase).toBe('waiting')
      expect(store.tick).toBe(0)
      expect(store.player).toBeNull()
      expect(store.visibleZones).toEqual({})
      expect(store.allPlayers).toEqual({})
      expect(store.teams).toBeNull()
      expect(store.towers).toEqual([])
      expect(store.creeps).toEqual([])
      expect(store.events).toEqual([])
      expect(store.announcements).toEqual([])
      expect(store.nextTickIn).toBe(0)
      expect(store.scoreboard).toEqual([])
      expect(store.gameOverStats).toBeNull()
      expect(store.winner).toBeNull()
    })
  })

  describe('computed getters', () => {
    describe('currentZone', () => {
      it('returns null when no player', () => {
        const store = useGameStore()
        expect(store.currentZone).toBeNull()
      })

      it('returns zone data for player zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ zone: 'radiant-fountain' }) },
        }))

        expect(store.currentZone).not.toBeNull()
        expect(store.currentZone!.id).toBe('radiant-fountain')
        expect(store.currentZone!.name).toBe('Radiant Fountain')
      })

      it('returns null for unknown zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ zone: 'nonexistent-zone' }) },
        }))

        expect(store.currentZone).toBeNull()
      })
    })

    describe('isAlive', () => {
      it('returns false when no player', () => {
        const store = useGameStore()
        expect(store.isAlive).toBe(false)
      })

      it('returns true when player is alive', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ alive: true }) },
        }))

        expect(store.isAlive).toBe(true)
      })

      it('returns false when player is dead', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ alive: false }) },
        }))

        expect(store.isAlive).toBe(false)
      })
    })

    describe('canBuy', () => {
      it('returns false when no player', () => {
        const store = useGameStore()
        expect(store.canBuy).toBe(false)
      })

      it('returns true when alive in shop zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ zone: 'radiant-fountain', alive: true }) },
        }))

        expect(store.canBuy).toBe(true)
      })

      it('returns false when alive in non-shop zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ zone: 'mid-t1-rad', alive: true }) },
        }))

        expect(store.canBuy).toBe(false)
      })

      it('returns false when dead in shop zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ zone: 'radiant-fountain', alive: false }) },
        }))

        expect(store.canBuy).toBe(false)
      })
    })

    describe('kda', () => {
      it('returns 0/0/0 when no player', () => {
        const store = useGameStore()
        expect(store.kda).toBe('0/0/0')
      })

      it('returns formatted KDA string', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ kills: 5, deaths: 2, assists: 7 }) },
        }))

        expect(store.kda).toBe('5/2/7')
      })
    })

    describe('heroLevel', () => {
      it('returns 0 when no player', () => {
        const store = useGameStore()
        expect(store.heroLevel).toBe(0)
      })

      it('returns player level', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer({ level: 8 }) },
        }))

        expect(store.heroLevel).toBe(8)
      })
    })

    describe('nearbyEnemies', () => {
      it('returns empty array when no player', () => {
        const store = useGameStore()
        expect(store.nearbyEnemies).toEqual([])
      })

      it('returns enemies in same zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const enemy = makePlayer({ id: 'e1', name: 'Enemy', team: 'dire', zone: 'mid-t1-rad', alive: true })
        const allyOther = makePlayer({ id: 'a1', name: 'Ally', team: 'radiant', zone: 'mid-t1-rad', alive: true })
        const farEnemy = makePlayer({ id: 'e2', name: 'FarEnemy', team: 'dire', zone: 'bot-t1-dire', alive: true })

        store.updateFromTick(makeTickMessage({
          players: {
            p1: makePlayer(),
            e1: enemy,
            a1: allyOther,
            e2: farEnemy,
          },
        }))

        expect(store.nearbyEnemies).toHaveLength(1)
        expect(store.nearbyEnemies[0]!.id).toBe('e1')
      })

      it('excludes dead enemies', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const deadEnemy = makePlayer({ id: 'e1', team: 'dire', zone: 'mid-t1-rad', alive: false })

        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer(), e1: deadEnemy },
        }))

        expect(store.nearbyEnemies).toHaveLength(0)
      })
    })

    describe('nearbyAllies', () => {
      it('returns empty array when no player', () => {
        const store = useGameStore()
        expect(store.nearbyAllies).toEqual([])
      })

      it('returns allies in same zone excluding self', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const ally = makePlayer({ id: 'a1', name: 'Ally', team: 'radiant', zone: 'mid-t1-rad', alive: true })

        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer(), a1: ally },
        }))

        expect(store.nearbyAllies).toHaveLength(1)
        expect(store.nearbyAllies[0]!.id).toBe('a1')
      })

      it('excludes dead allies', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const deadAlly = makePlayer({ id: 'a1', team: 'radiant', zone: 'mid-t1-rad', alive: false })

        store.updateFromTick(makeTickMessage({
          players: { p1: makePlayer(), a1: deadAlly },
        }))

        expect(store.nearbyAllies).toHaveLength(0)
      })
    })
  })

  describe('actions', () => {
    describe('updateFromTick', () => {
      it('updates tick number and phase', () => {
        const store = useGameStore()
        store.updateFromTick(makeTickMessage({ tick: 42, phase: 'playing' }))

        expect(store.tick).toBe(42)
        expect(store.phase).toBe('playing')
      })

      it('updates player state when playerId is set', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const player = makePlayer({ hp: 123, gold: 999 })
        store.updateFromTick(makeTickMessage({ players: { p1: player } }))

        expect(store.player).not.toBeNull()
        expect(store.player!.hp).toBe(123)
        expect(store.player!.gold).toBe(999)
      })

      it('does not set player when playerId is missing from players', () => {
        const store = useGameStore()
        store.playerId = 'missing'

        store.updateFromTick(makeTickMessage({ players: { p1: makePlayer() } }))

        expect(store.player).toBeNull()
      })

      it('updates allPlayers, visibleZones, and teams', () => {
        const store = useGameStore()

        const p1 = makePlayer()
        const p2 = makePlayer({ id: 'p2', team: 'dire' })
        const zones = {
          'mid-t1-rad': makeZone('mid-t1-rad'),
          'top-t1-rad': makeZone('top-t1-rad'),
        }
        const teams = makeTeams()

        store.updateFromTick(makeTickMessage({ players: { p1, p2 }, zones, teams }))

        expect(Object.keys(store.allPlayers)).toHaveLength(2)
        expect(Object.keys(store.visibleZones)).toHaveLength(2)
        expect(store.teams).toEqual(teams)
      })

      it('updates towers and creeps when present', () => {
        const store = useGameStore()

        const msg = makeTickMessage()
        ;(msg.state as Record<string, unknown>).towers = [
          { team: 'radiant', zone: 'mid-t1-rad', hp: 1500, maxHp: 2000, alive: true },
        ]
        ;(msg.state as Record<string, unknown>).creeps = [
          { id: 'c1', team: 'radiant', zone: 'mid-t1-rad', hp: 200, type: 'melee' },
        ]

        store.updateFromTick(msg)

        expect(store.towers).toHaveLength(1)
        expect(store.creeps).toHaveLength(1)
      })

      it('builds scoreboard from players', () => {
        const store = useGameStore()

        const p1 = makePlayer({ kills: 3, deaths: 1, assists: 2, gold: 500, level: 5 })
        store.updateFromTick(makeTickMessage({ players: { p1 } }))

        expect(store.scoreboard).toHaveLength(1)
        expect(store.scoreboard[0]).toMatchObject({
          id: 'p1',
          kills: 3,
          deaths: 1,
          assists: 2,
          gold: 500,
          level: 5,
        })
      })

      it('hides gold and items for fogged players', () => {
        const store = useGameStore()

        const foggedPlayer = {
          id: 'e1',
          name: 'FoggedEnemy',
          team: 'dire',
          heroId: 'daemon',
          level: 5,
          alive: true,
          fogged: true,
          kills: 2,
          deaths: 0,
          assists: 1,
          gold: 999,
          items: ['boots'],
        }

        const msg = makeTickMessage({ players: { e1: foggedPlayer as unknown as PlayerState } })
        store.updateFromTick(msg)

        expect(store.scoreboard).toHaveLength(1)
        expect(store.scoreboard[0]!.gold).toBe(0)
        expect(store.scoreboard[0]!.items).toEqual([])
      })

      it('scoreboard entries include alive and respawnTick fields', () => {
        const store = useGameStore()

        const alive = makePlayer({ id: 'p1', alive: true, respawnTick: null })
        const dead = makePlayer({ id: 'p2', alive: false, respawnTick: 20, team: 'dire' })
        store.updateFromTick(makeTickMessage({ tick: 15, players: { p1: alive, p2: dead } }))

        const p1Entry = store.scoreboard.find(e => e.id === 'p1')
        const p2Entry = store.scoreboard.find(e => e.id === 'p2')
        expect(p1Entry!.alive).toBe(true)
        expect(p1Entry!.respawnTick).toBeNull()
        expect(p2Entry!.alive).toBe(false)
        expect(p2Entry!.respawnTick).toBe(20)
      })

      it('scoreboard marks fogged field on fogged players', () => {
        const store = useGameStore()

        const foggedPlayer = {
          id: 'e1',
          name: 'FoggedEnemy',
          team: 'dire',
          heroId: 'daemon',
          level: 5,
          alive: true,
          fogged: true,
          kills: 2,
          deaths: 0,
          assists: 1,
          gold: 999,
          items: ['boots'],
        }
        const normalPlayer = makePlayer({ id: 'p1' })

        store.updateFromTick(makeTickMessage({
          players: { e1: foggedPlayer as unknown as PlayerState, p1: normalPlayer },
        }))

        const foggedEntry = store.scoreboard.find(e => e.id === 'e1')
        const normalEntry = store.scoreboard.find(e => e.id === 'p1')
        expect(foggedEntry!.fogged).toBe(true)
        expect(normalEntry!.fogged).toBe(false)
      })

      it('team stats (kills, towerKills, gold) are accessible', () => {
        const store = useGameStore()
        const teams = makeTeams()
        store.updateFromTick(makeTickMessage({ teams }))

        expect(store.teams!.radiant.kills).toBe(5)
        expect(store.teams!.radiant.towerKills).toBe(1)
        expect(store.teams!.radiant.gold).toBe(5000)
        expect(store.teams!.dire.kills).toBe(3)
        expect(store.teams!.dire.towerKills).toBe(0)
        expect(store.teams!.dire.gold).toBe(4200)
      })

      it('respawn tick countdown can be calculated from current tick', () => {
        const store = useGameStore()

        const dead = makePlayer({ id: 'p1', alive: false, respawnTick: 25 })
        store.updateFromTick(makeTickMessage({ tick: 20, players: { p1: dead } }))

        const entry = store.scoreboard.find(e => e.id === 'p1')!
        const remainingTicks = entry.respawnTick! - store.tick
        expect(remainingTicks).toBe(5)
      })
    })

    describe('addEvents', () => {
      it('adds events to the list', () => {
        const store = useGameStore()
        const events: GameEvent[] = [
          { tick: 1, type: 'kill', payload: { killer: 'p1', victim: 'p2' } },
          { tick: 2, type: 'tower_destroy', payload: { zone: 'mid-t1-rad' } },
        ]

        store.addEvents(events)

        expect(store.events).toHaveLength(2)
      })

      it('caps events at 200', () => {
        const store = useGameStore()

        // Add 250 events
        const batch: GameEvent[] = Array.from({ length: 250 }, (_, i) => ({
          tick: i,
          type: 'test',
          payload: {},
        }))
        store.addEvents(batch)

        expect(store.events).toHaveLength(200)
        // Should keep the last 200
        expect(store.events[0]!.tick).toBe(50)
      })
    })

    describe('addAnnouncement', () => {
      it('adds announcement text', () => {
        const store = useGameStore()
        store.addAnnouncement('First Blood!')

        expect(store.announcements).toEqual(['First Blood!'])
      })

      it('caps announcements at 50', () => {
        const store = useGameStore()

        for (let i = 0; i < 60; i++) {
          store.addAnnouncement(`Announcement ${i}`)
        }

        expect(store.announcements).toHaveLength(50)
        expect(store.announcements[0]).toBe('Announcement 10')
      })
    })

    describe('setPhase', () => {
      it('updates the phase', () => {
        const store = useGameStore()

        store.setPhase('picking')
        expect(store.phase).toBe('picking')

        store.setPhase('playing')
        expect(store.phase).toBe('playing')
      })
    })

    describe('setGameOver', () => {
      it('sets winner, stats, and phase to ended', () => {
        const store = useGameStore()

        const stats: Record<string, PlayerEndStats> = {
          p1: { kills: 5, deaths: 1, assists: 3, gold: 5000, items: ['boots'], heroDamage: 8000, towerDamage: 2000 },
        }

        store.setGameOver('radiant', stats)

        expect(store.winner).toBe('radiant')
        expect(store.gameOverStats).toEqual(stats)
        expect(store.phase).toBe('ended')
      })
    })

    describe('reset', () => {
      it('resets all state to defaults', () => {
        const store = useGameStore()

        // Set up some state
        store.gameId = 'game-1'
        store.playerId = 'p1'
        store.setPhase('playing')
        store.updateFromTick(makeTickMessage({ tick: 50 }))
        store.addEvents([{ tick: 1, type: 'test', payload: {} }])
        store.addAnnouncement('Test')
        store.setGameOver('radiant', {})

        // Reset
        store.reset()

        expect(store.gameId).toBeNull()
        expect(store.phase).toBe('waiting')
        expect(store.tick).toBe(0)
        expect(store.player).toBeNull()
        expect(store.visibleZones).toEqual({})
        expect(store.allPlayers).toEqual({})
        expect(store.teams).toBeNull()
        expect(store.towers).toEqual([])
        expect(store.creeps).toEqual([])
        expect(store.events).toEqual([])
        expect(store.announcements).toEqual([])
        expect(store.nextTickIn).toBe(0)
        expect(store.scoreboard).toEqual([])
        expect(store.gameOverStats).toBeNull()
        expect(store.winner).toBeNull()
      })
    })
  })

  describe('state transitions', () => {
    it('handles full game lifecycle: waiting → playing → ended', () => {
      const store = useGameStore()
      store.playerId = 'p1'

      expect(store.phase).toBe('waiting')

      // Game starts
      store.setPhase('picking')
      expect(store.phase).toBe('picking')

      // Picking complete
      store.updateFromTick(makeTickMessage({ phase: 'playing', tick: 1 }))
      expect(store.phase).toBe('playing')

      // Multiple ticks
      store.updateFromTick(makeTickMessage({ phase: 'playing', tick: 50 }))
      expect(store.tick).toBe(50)

      // Game ends
      store.setGameOver('dire', {
        p1: { kills: 3, deaths: 5, assists: 2, gold: 3000, items: [], heroDamage: 5000, towerDamage: 1000 },
      })
      expect(store.phase).toBe('ended')
      expect(store.winner).toBe('dire')
    })

    it('reset after game over returns to initial state', () => {
      const store = useGameStore()
      store.playerId = 'p1'
      store.setGameOver('radiant', {})

      store.reset()

      expect(store.phase).toBe('waiting')
      expect(store.winner).toBeNull()
      // playerId is not cleared by reset — it persists for reconnection
      expect(store.playerId).toBe('p1')
    })
  })
})
