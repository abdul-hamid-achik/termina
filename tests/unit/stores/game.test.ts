import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '~~/app/stores/game'
import type { CycleStateMessage, PlayerEndStats } from '~~/shared/types/protocol'
import type { PlayerState, GameEvent, TeamState, ZoneRuntimeState } from '~~/shared/types/game'

// ── Helpers ───────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-t1-chaff',
    integ: 500,
    maxInteg: 550,
    bw: 200,
    maxBw: 280,
    level: 3,
    xp: 150,
    scrip: 300,
    items: ['boots', null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 5,
    ice: 15,
    kills: 2,
    deaths: 1,
    assists: 3,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    ...overrides,
  }
}

function makeTeams(): { chaff: TeamState; audit: TeamState } {
  return {
    chaff: { id: 'chaff', kills: 5, iceKills: 1, scrip: 5000 },
    audit: { id: 'audit', kills: 3, iceKills: 0, scrip: 4200 },
  }
}

function makeZone(id: string): ZoneRuntimeState {
  return { id, wards: [] }
}

function makeCycleMessage(
  overrides: Partial<{
    cycle: number
    phase: string
    players: Record<string, PlayerState>
    zones: Record<string, ZoneRuntimeState>
    teams: { chaff: TeamState; audit: TeamState }
  }> = {},
): CycleStateMessage {
  const players = overrides.players ?? { p1: makePlayer() }
  return {
    type: 'cycle_state',
    cycle: overrides.cycle ?? 10,
    state: {
      phase: overrides.phase ?? 'playing',
      players,
      zones: overrides.zones ?? { 'coldstore-t1-chaff': makeZone('coldstore-t1-chaff') },
      teams: overrides.teams ?? makeTeams(),
    } as CycleStateMessage['state'],
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
      expect(store.cycle).toBe(0)
      expect(store.player).toBeNull()
      expect(store.visibleZones).toEqual({})
      expect(store.allPlayers).toEqual({})
      expect(store.teams).toBeNull()
      expect(store.ice).toEqual([])
      expect(store.waves).toEqual([])
      expect(store.events).toEqual([])
      expect(store.announcements).toEqual([])
      expect(store.nextCycleIn).toBe(0)
      expect(store.scoreboard).toEqual([])
      expect(store.gameOverStats).toBeNull()
      expect(store.winner).toBeNull()
    })
  })

  describe('delta merge (updateFromCycle)', () => {
    it('retains phase + teams when a steady-state delta omits them', () => {
      const store = useGameStore()
      // Full cycle first (server always sends phase + teams on a full/changed cycle).
      store.updateFromCycle(makeCycleMessage({ phase: 'playing' }))
      expect(store.phase).toBe('playing')
      expect(store.teams).not.toBeNull()

      // A delta-compressed steady cycle OMITS phase + teams (unchanged). They must
      // be preserved, not clobbered to undefined.
      store.updateFromCycle({
        type: 'cycle_state',
        cycle: 11,
        state: {
          players: { p1: makePlayer() },
          zones: { 'coldstore-t1-chaff': makeZone('coldstore-t1-chaff') },
        },
      } as never)

      expect(store.phase).toBe('playing')
      expect(store.teams).not.toBeNull()
      expect(store.teams?.chaff).toBeDefined()
    })

    it('tracks the server fog list (visibleZoneIds) distinctly from the zones map', () => {
      const store = useGameStore()
      store.updateFromCycle({
        type: 'cycle_state',
        cycle: 5,
        state: {
          phase: 'playing',
          players: { p1: makePlayer() },
          // zones MAP carries two zones (one fogged-but-present)...
          zones: {
            'coldstore-cross': makeZone('coldstore-cross'),
            'seawall-cross': makeZone('seawall-cross'),
          },
          // ...but only one is actually visible this cycle.
          visibleZones: ['coldstore-cross'],
          teams: makeTeams(),
        },
      } as never)

      expect(store.visibleZoneIds).toEqual(['coldstore-cross'])
      // The map still holds both (for per-zone data lookups) — the fog list is
      // the narrower, authoritative set.
      expect(Object.keys(store.visibleZones)).toHaveLength(2)
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
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ zone: 'rookery-anchor' }) },
          }),
        )

        expect(store.currentZone).not.toBeNull()
        expect(store.currentZone!.id).toBe('rookery-anchor')
        expect(store.currentZone!.name).toBe('Rookery Anchor')
      })

      it('returns null for unknown zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ zone: 'nonexistent-zone' }) },
          }),
        )

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
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ alive: true }) },
          }),
        )

        expect(store.isAlive).toBe(true)
      })

      it('returns false when player is dead', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ alive: false }) },
          }),
        )

        expect(store.isAlive).toBe(false)
      })
    })

    // The server queues item actives in their own per-player slot, so the two
    // client gates have to mirror it — otherwise the UI buffers the ability
    // that the item was spent to set up, and the combo slips to the next cycle.
    describe('canAct / canUseItem (main + item slots)', () => {
      function livePlayer() {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromCycle(
          makeCycleMessage({ cycle: 12, players: { p1: makePlayer({ alive: true }) } }),
        )
        return store
      }

      it('an item active consumes only the item slot', () => {
        const store = livePlayer()
        store.markActionSent('use jump_shunt coldstore-cross')

        expect(store.canUseItem).toBe(false)
        expect(store.canAct).toBe(true)
      })

      it('a main action consumes only the main slot', () => {
        const store = livePlayer()
        store.markActionSent('cast r')

        expect(store.canAct).toBe(false)
        expect(store.canUseItem).toBe(true)
      })

      it('both slots reopen on the next cycle', () => {
        const store = livePlayer()
        store.markActionSent('use jump_shunt coldstore-cross')
        store.markActionSent('cast r')
        expect(store.canAct).toBe(false)
        expect(store.canUseItem).toBe(false)

        store.updateFromCycle(
          makeCycleMessage({ cycle: 13, players: { p1: makePlayer({ alive: true }) } }),
        )
        expect(store.canAct).toBe(true)
        expect(store.canUseItem).toBe(true)
      })

      it('is closed while dead', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromCycle(
          makeCycleMessage({ cycle: 12, players: { p1: makePlayer({ alive: false }) } }),
        )
        expect(store.canUseItem).toBe(false)
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
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ zone: 'rookery-anchor', alive: true }) },
          }),
        )

        expect(store.canBuy).toBe(true)
      })

      it('returns false when alive in non-shop zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ zone: 'coldstore-t1-chaff', alive: true }) },
          }),
        )

        expect(store.canBuy).toBe(false)
      })

      it('returns false when dead in shop zone', () => {
        const store = useGameStore()
        store.playerId = 'p1'
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ zone: 'rookery-anchor', alive: false }) },
          }),
        )

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
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ kills: 5, deaths: 2, assists: 7 }) },
          }),
        )

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
        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer({ level: 8 }) },
          }),
        )

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

        const enemy = makePlayer({
          id: 'e1',
          name: 'Enemy',
          team: 'audit',
          zone: 'coldstore-t1-chaff',
          alive: true,
        })
        const allyOther = makePlayer({
          id: 'a1',
          name: 'Ally',
          team: 'chaff',
          zone: 'coldstore-t1-chaff',
          alive: true,
        })
        const farEnemy = makePlayer({
          id: 'e2',
          name: 'FarEnemy',
          team: 'audit',
          zone: 'shallows-t1-audit',
          alive: true,
        })

        store.updateFromCycle(
          makeCycleMessage({
            players: {
              p1: makePlayer(),
              e1: enemy,
              a1: allyOther,
              e2: farEnemy,
            },
          }),
        )

        expect(store.nearbyEnemies).toHaveLength(1)
        expect(store.nearbyEnemies[0]!.id).toBe('e1')
      })

      it('excludes dead enemies', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const deadEnemy = makePlayer({
          id: 'e1',
          team: 'audit',
          zone: 'coldstore-t1-chaff',
          alive: false,
        })

        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer(), e1: deadEnemy },
          }),
        )

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

        const ally = makePlayer({
          id: 'a1',
          name: 'Ally',
          team: 'chaff',
          zone: 'coldstore-t1-chaff',
          alive: true,
        })

        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer(), a1: ally },
          }),
        )

        expect(store.nearbyAllies).toHaveLength(1)
        expect(store.nearbyAllies[0]!.id).toBe('a1')
      })

      it('excludes dead allies', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const deadAlly = makePlayer({
          id: 'a1',
          team: 'chaff',
          zone: 'coldstore-t1-chaff',
          alive: false,
        })

        store.updateFromCycle(
          makeCycleMessage({
            players: { p1: makePlayer(), a1: deadAlly },
          }),
        )

        expect(store.nearbyAllies).toHaveLength(0)
      })
    })
  })

  describe('actions', () => {
    describe('updateFromCycle', () => {
      it('updates cycle number and phase', () => {
        const store = useGameStore()
        store.updateFromCycle(makeCycleMessage({ cycle: 42, phase: 'playing' }))

        expect(store.cycle).toBe(42)
        expect(store.phase).toBe('playing')
      })

      it('updates player state when playerId is set', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const player = makePlayer({ integ: 123, scrip: 999 })
        store.updateFromCycle(makeCycleMessage({ players: { p1: player } }))

        expect(store.player).not.toBeNull()
        expect(store.player!.integ).toBe(123)
        expect(store.player!.scrip).toBe(999)
      })

      it('does not set player when playerId is missing from players', () => {
        const store = useGameStore()
        store.playerId = 'missing'

        store.updateFromCycle(makeCycleMessage({ players: { p1: makePlayer() } }))

        expect(store.player).toBeNull()
      })

      it('updates allPlayers, visibleZones, and teams', () => {
        const store = useGameStore()

        const p1 = makePlayer()
        const p2 = makePlayer({ id: 'p2', team: 'audit' })
        const zones = {
          'coldstore-t1-chaff': makeZone('coldstore-t1-chaff'),
          'seawall-t1-chaff': makeZone('seawall-t1-chaff'),
        }
        const teams = makeTeams()

        store.updateFromCycle(makeCycleMessage({ players: { p1, p2 }, zones, teams }))

        expect(Object.keys(store.allPlayers)).toHaveLength(2)
        expect(Object.keys(store.visibleZones)).toHaveLength(2)
        expect(store.teams).toEqual(teams)
      })

      it('updates ice and waves when present', () => {
        const store = useGameStore()

        const msg = makeCycleMessage()
        ;(msg.state as unknown as Record<string, unknown>).ice = [
          { team: 'chaff', zone: 'coldstore-t1-chaff', integ: 1500, maxInteg: 2000, alive: true },
        ]
        ;(msg.state as unknown as Record<string, unknown>).waves = [
          { id: 'c1', team: 'chaff', zone: 'coldstore-t1-chaff', integ: 200, type: 'line' },
        ]

        store.updateFromCycle(msg)

        expect(store.ice).toHaveLength(1)
        expect(store.waves).toHaveLength(1)
      })

      it('stores ice in game store and persists across updates', () => {
        const store = useGameStore()

        const msg1 = makeCycleMessage({ cycle: 1 })
        ;(msg1.state as unknown as Record<string, unknown>).ice = [
          { team: 'chaff', zone: 'coldstore-t1-chaff', integ: 1500, maxInteg: 2000, alive: true },
          { team: 'audit', zone: 'coldstore-t1-audit', integ: 2000, maxInteg: 2000, alive: true },
        ]

        store.updateFromCycle(msg1)

        expect(store.ice).toHaveLength(2)
        expect(store.ice[0]!.zone).toBe('coldstore-t1-chaff')
        expect(store.ice[1]!.zone).toBe('coldstore-t1-audit')
      })

      it('updates ice from cycle_state', () => {
        const store = useGameStore()

        const msg1 = makeCycleMessage({ cycle: 1 })
        ;(msg1.state as unknown as Record<string, unknown>).ice = [
          { team: 'chaff', zone: 'coldstore-t1-chaff', integ: 2000, maxInteg: 2000, alive: true },
        ]

        store.updateFromCycle(msg1)
        expect(store.ice).toHaveLength(1)
        expect(store.ice[0]!.integ).toBe(2000)

        const msg2 = makeCycleMessage({ cycle: 2 })
        ;(msg2.state as unknown as Record<string, unknown>).ice = [
          { team: 'chaff', zone: 'coldstore-t1-chaff', integ: 1500, maxInteg: 2000, alive: true },
        ]

        store.updateFromCycle(msg2)
        expect(store.ice).toHaveLength(1)
        expect(store.ice[0]!.integ).toBe(1500)
      })

      it('builds scoreboard from players', () => {
        const store = useGameStore()

        const p1 = makePlayer({ kills: 3, deaths: 1, assists: 2, scrip: 500, level: 5 })
        store.updateFromCycle(makeCycleMessage({ players: { p1 } }))

        expect(store.scoreboard).toHaveLength(1)
        expect(store.scoreboard[0]).toMatchObject({
          id: 'p1',
          kills: 3,
          deaths: 1,
          assists: 2,
          scrip: 500,
          level: 5,
        })
      })

      it('hides scrip and items for fogged players', () => {
        const store = useGameStore()

        const foggedPlayer = {
          id: 'e1',
          name: 'FoggedEnemy',
          team: 'audit',
          heroId: 'daemon',
          level: 5,
          alive: true,
          fogged: true,
          kills: 2,
          deaths: 0,
          assists: 1,
          scrip: 999,
          items: ['boots'],
        }

        const msg = makeCycleMessage({ players: { e1: foggedPlayer as unknown as PlayerState } })
        store.updateFromCycle(msg)

        expect(store.scoreboard).toHaveLength(1)
        expect(store.scoreboard[0]!.scrip).toBe(0)
        expect(store.scoreboard[0]!.items).toEqual([])
        // ...but KDA + level stay public — the scoreboard shows an enemy's record
        // even in fog (the real FoggedPlayer now carries these; it didn't before,
        // so fogged enemies rendered 0/0/0).
        expect(store.scoreboard[0]!.kills).toBe(2)
        expect(store.scoreboard[0]!.deaths).toBe(0)
        expect(store.scoreboard[0]!.assists).toBe(1)
        expect(store.scoreboard[0]!.level).toBe(5)
      })

      it('scoreboard entries include alive and respawnCycle fields', () => {
        const store = useGameStore()

        const alive = makePlayer({ id: 'p1', alive: true, respawnCycle: null })
        const dead = makePlayer({ id: 'p2', alive: false, respawnCycle: 20, team: 'audit' })
        store.updateFromCycle(makeCycleMessage({ cycle: 15, players: { p1: alive, p2: dead } }))

        const p1Entry = store.scoreboard.find((e) => e.id === 'p1')
        const p2Entry = store.scoreboard.find((e) => e.id === 'p2')
        expect(p1Entry!.alive).toBe(true)
        expect(p1Entry!.respawnCycle).toBeNull()
        expect(p2Entry!.alive).toBe(false)
        expect(p2Entry!.respawnCycle).toBe(20)
      })

      it('scoreboard marks fogged field on fogged players', () => {
        const store = useGameStore()

        const foggedPlayer = {
          id: 'e1',
          name: 'FoggedEnemy',
          team: 'audit',
          heroId: 'daemon',
          level: 5,
          alive: true,
          fogged: true,
          kills: 2,
          deaths: 0,
          assists: 1,
          scrip: 999,
          items: ['boots'],
        }
        const normalPlayer = makePlayer({ id: 'p1' })

        store.updateFromCycle(
          makeCycleMessage({
            players: { e1: foggedPlayer as unknown as PlayerState, p1: normalPlayer },
          }),
        )

        const foggedEntry = store.scoreboard.find((e) => e.id === 'e1')
        const normalEntry = store.scoreboard.find((e) => e.id === 'p1')
        expect(foggedEntry!.fogged).toBe(true)
        expect(normalEntry!.fogged).toBe(false)
      })

      it('team stats (kills, iceKills, scrip) are accessible', () => {
        const store = useGameStore()
        const teams = makeTeams()
        store.updateFromCycle(makeCycleMessage({ teams }))

        expect(store.teams!.chaff.kills).toBe(5)
        expect(store.teams!.chaff.iceKills).toBe(1)
        expect(store.teams!.chaff.scrip).toBe(5000)
        expect(store.teams!.audit.kills).toBe(3)
        expect(store.teams!.audit.iceKills).toBe(0)
        expect(store.teams!.audit.scrip).toBe(4200)
      })

      it('respawn cycle countdown can be calculated from current tick', () => {
        const store = useGameStore()

        const dead = makePlayer({ id: 'p1', alive: false, respawnCycle: 25 })
        store.updateFromCycle(makeCycleMessage({ cycle: 20, players: { p1: dead } }))

        const entry = store.scoreboard.find((e) => e.id === 'p1')!
        const remainingTicks = entry.respawnCycle! - store.cycle
        expect(remainingTicks).toBe(5)
      })
    })

    describe('addEvents', () => {
      it('adds events to the list', () => {
        const store = useGameStore()
        const events: GameEvent[] = [
          { cycle: 1, type: 'kill', payload: { killer: 'p1', victim: 'p2' } },
          { cycle: 2, type: 'ice_destroy', payload: { zone: 'coldstore-t1-chaff' } },
        ]

        store.addEvents(events)

        expect(store.events).toHaveLength(2)
      })

      it('caps events at 200', () => {
        const store = useGameStore()

        // Add 250 events
        const batch: GameEvent[] = Array.from({ length: 250 }, (_, i) => ({
          cycle: i,
          type: 'test',
          payload: {},
        }))
        store.addEvents(batch)

        expect(store.events).toHaveLength(200)
        // Should keep the last 200
        expect(store.events[0]!.cycle).toBe(50)
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
          p1: {
            kills: 5,
            deaths: 1,
            assists: 3,
            scrip: 5000,
            items: ['boots'],
            heroDamage: 8000,
            iceDamage: 2000,
          },
        }

        store.setGameOver('chaff', stats)

        expect(store.winner).toBe('chaff')
        expect(store.gameOverStats).toEqual(stats)
        expect(store.phase).toBe('ended')
      })
    })

    describe('cycle_state game-over fallback', () => {
      it('derives the post-game screen from a final cycle_state carrying phase ended + winner', () => {
        const store = useGameStore()
        store.playerId = 'p1'

        const msg = makeCycleMessage({
          cycle: 60,
          phase: 'ended',
          players: { p1: makePlayer({ kills: 2, deaths: 1, assists: 4, scrip: 300, level: 6 }) },
        })
        ;(msg.state as { winner?: string }).winner = 'chaff'
        store.updateFromCycle(msg)

        expect(store.phase).toBe('ended')
        expect(store.winner).toBe('chaff')
        expect(store.gameOverStats?.['p1']).toMatchObject({
          kills: 2,
          deaths: 1,
          assists: 4,
          scrip: 300,
          level: 6,
        })
        expect(store.gameOverDurationTicks).toBe(60)
        // Fallback path can't know ranked-ness — never claims a ranked result.
        expect(store.gameOverRanked).toBe(false)
      })

      it('does not clobber a game_over message that already arrived', () => {
        const store = useGameStore()
        store.setGameOver('audit', {}, -12, true, 55)

        const msg = makeCycleMessage({ cycle: 56, phase: 'ended' })
        ;(msg.state as { winner?: string }).winner = 'audit'
        store.updateFromCycle(msg)

        // The authoritative message's mmr/ranked survive the fallback.
        expect(store.gameOverMmrChange).toBe(-12)
        expect(store.gameOverRanked).toBe(true)
        expect(store.gameOverDurationTicks).toBe(55)
      })
    })

    describe('reset', () => {
      it('resets all state to defaults', () => {
        const store = useGameStore()

        // Set up some state
        store.gameId = 'game-1'
        store.playerId = 'p1'
        store.setPhase('playing')
        store.updateFromCycle(makeCycleMessage({ cycle: 50 }))
        store.addEvents([{ cycle: 1, type: 'test', payload: {} }])
        store.addAnnouncement('Test')
        store.setGameOver('chaff', {})

        // Reset
        store.reset()

        expect(store.gameId).toBeNull()
        expect(store.phase).toBe('waiting')
        expect(store.cycle).toBe(0)
        expect(store.player).toBeNull()
        expect(store.visibleZones).toEqual({})
        expect(store.allPlayers).toEqual({})
        expect(store.teams).toBeNull()
        expect(store.ice).toEqual([])
        expect(store.waves).toEqual([])
        expect(store.events).toEqual([])
        expect(store.announcements).toEqual([])
        expect(store.nextCycleIn).toBe(0)
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
      store.updateFromCycle(makeCycleMessage({ phase: 'playing', cycle: 1 }))
      expect(store.phase).toBe('playing')

      // Multiple ticks
      store.updateFromCycle(makeCycleMessage({ phase: 'playing', cycle: 50 }))
      expect(store.cycle).toBe(50)

      // Game ends
      store.setGameOver('audit', {
        p1: {
          kills: 3,
          deaths: 5,
          assists: 2,
          scrip: 3000,
          items: [],
          heroDamage: 5000,
          iceDamage: 1000,
        },
      })
      expect(store.phase).toBe('ended')
      expect(store.winner).toBe('audit')
    })

    it('reset after game over returns to initial state', () => {
      const store = useGameStore()
      store.playerId = 'p1'
      store.setGameOver('chaff', {})

      store.reset()

      expect(store.phase).toBe('waiting')
      expect(store.winner).toBeNull()
      // playerId is not cleared by reset — it persists for reconnection
      expect(store.playerId).toBe('p1')
    })
  })
})

describe('Game Store — overhaul state (fog-safe lastSeen / net worth / objectives / rosters)', () => {
  // A FoggedPlayer arrives without zone/hp/cooldowns; cast at the call site.
  // Mirrors the real FoggedPlayer shape (VisionCalculator) — KDA + level are
  // public even in fog. Keep these in sync so a fixture can't mask a regression
  // (a too-thin fogged fixture once hid fogged enemies rendering 0/0/0 KDA).
  const fogged = (id: string, team: 'chaff' | 'audit', alive = true) =>
    ({
      id,
      name: id,
      team,
      heroId: 'null_ref',
      level: 3,
      kills: 0,
      deaths: 0,
      assists: 0,
      alive,
      fogged: true,
    }) as unknown as PlayerState

  // This is a top-level describe (sibling of 'Game Store'), so it needs its own
  // Pinia setup — previously its tests only passed by leaking an active Pinia
  // from the prior block, which broke as soon as a test was added/reordered.
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('records last-seen only for un-fogged players, never overwriting from fog', () => {
    const store = useGameStore()
    store.playerId = 'me'
    const me = makePlayer({ id: 'me', team: 'chaff', zone: 'coldstore-cross' })
    const enemyVisible = makePlayer({ id: 'e1', team: 'audit', zone: 'seawall-cross' })
    store.updateFromCycle(makeCycleMessage({ cycle: 10, players: { me, e1: enemyVisible } }))
    expect(store.lastSeen['e1']).toEqual({ zone: 'seawall-cross', cycle: 10 })

    // e1 now fogged (no zone) — last-seen must stay at the last observed position.
    store.updateFromCycle(
      makeCycleMessage({ cycle: 14, players: { me, e1: fogged('e1', 'audit') } }),
    )
    expect(store.lastSeen['e1']).toEqual({ zone: 'seawall-cross', cycle: 10 })
  })

  it('carries an enemy net worth forward while fogged (no crater to zero)', () => {
    const store = useGameStore()
    store.playerId = 'me'
    const me = makePlayer({ id: 'me', team: 'chaff' })
    const enemy = makePlayer({ id: 'e1', team: 'audit', scrip: 1000, items: [] })
    store.updateFromCycle(makeCycleMessage({ cycle: 10, players: { me, e1: enemy } }))
    const auditBefore = store.netWorth.audit
    expect(auditBefore).toBe(1000)

    store.updateFromCycle(
      makeCycleMessage({ cycle: 14, players: { me, e1: fogged('e1', 'audit') } }),
    )
    expect(store.netWorth.audit).toBe(auditBefore) // carried forward, not 0
  })

  it('an enemy never seen contributes 0 to team net worth (no phantom worth)', () => {
    const store = useGameStore()
    store.playerId = 'me'
    const me = makePlayer({ id: 'me', team: 'chaff' })
    // The audit enemy is fogged from the very first cycle — never observed, so it
    // has no last-known worth to carry. It must read 0, not crash or guess.
    store.updateFromCycle(
      makeCycleMessage({ cycle: 1, players: { me, e1: fogged('e1', 'audit') } }),
    )
    expect(store.netWorth.audit).toBe(0)
  })

  it('caps net-worth history at 40 samples', () => {
    const store = useGameStore()
    const me = makePlayer({ id: 'me' })
    for (let t = 1; t <= 45; t++) {
      store.updateFromCycle(makeCycleMessage({ cycle: t, players: { me } }))
    }
    expect(store.netWorthHistory.chaff.length).toBe(40)
  })

  it('ingests tenant/caches/backup and clears backup when null', () => {
    const store = useGameStore()
    const base = makeCycleMessage({ cycle: 10 })
    const s = base.state as unknown as Record<string, unknown>
    s.tenant = { alive: false, integ: 0, maxInteg: 5000, deathCycle: 10 }
    s.caches = [{ zone: 'cache-seawall', type: 'haste', cycle: 10 }]
    s.backup = { zone: 'hollow', cycle: 10, holderId: null }
    store.updateFromCycle(base)
    expect(store.tenant?.alive).toBe(false)
    expect(store.caches).toHaveLength(1)
    expect(store.backup?.zone).toBe('hollow')

    const next = makeCycleMessage({ cycle: 14 })
    ;(next.state as unknown as Record<string, unknown>).backup = null
    store.updateFromCycle(next)
    expect(store.backup).toBeNull()
  })

  it('rosters: empty before player data; enemyPlayers includes fogged, allyPlayers excludes self', () => {
    const store = useGameStore()
    expect(store.enemyPlayers).toEqual([])
    store.playerId = 'me'
    const me = makePlayer({ id: 'me', team: 'chaff' })
    const ally = makePlayer({ id: 'a1', team: 'chaff' })
    store.updateFromCycle(
      makeCycleMessage({ cycle: 10, players: { me, a1: ally, e1: fogged('e1', 'audit') } }),
    )
    expect(store.enemyPlayers.map((p) => p.id)).toEqual(['e1'])
    expect(store.allyPlayers.map((p) => p.id)).toEqual(['a1'])
  })

  it('bumps eventSeq + exposes latestEvents so game-feel survives the 200-cap', () => {
    const store = useGameStore()
    const mk = (n: number): GameEvent[] =>
      Array.from({ length: n }, (_, i) => ({ cycle: 1, type: 'damage', payload: { amount: i } }))
    store.addEvents(mk(150))
    expect(store.events.length).toBe(150)
    const seqAfter150 = store.eventSeq
    // Push past the 200 cap — events.length pins at 200 but eventSeq keeps moving.
    store.addEvents(mk(100))
    expect(store.events.length).toBe(200)
    expect(store.eventSeq).toBe(seqAfter150 + 100)
    expect(store.latestEvents.length).toBe(100)
  })
})
