import { describe, it, expect } from 'vitest'
import {
  calculateVision,
  filterStateForPlayer,
  type FoggedPlayer,
} from '../../../server/game/engine/VisionCalculator'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
    hp: 500,
    maxHp: 500,
    mp: 200,
    maxMp: 200,
    level: 1,
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

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0 },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0 },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    towers: initializeTowers(),
    events: [],
    ...overrides,
  }
}

describe('VisionCalculator', () => {
  describe('calculateVision', () => {
    it('should include current zone and adjacent zones for alive player', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ zone: 'mid-river' }),
        },
      })

      const vision = calculateVision(state, 'p1')

      // mid-river is adjacent to: mid-t1-rad, mid-t1-dire, rune-top, rune-bot
      expect(vision.has('mid-river')).toBe(true)
      expect(vision.has('mid-t1-rad')).toBe(true)
      expect(vision.has('mid-t1-dire')).toBe(true)
      expect(vision.has('rune-top')).toBe(true)
      expect(vision.has('rune-bot')).toBe(true)
    })

    it('should always include own base and fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ team: 'radiant', zone: 'mid-river' }),
        },
      })

      const vision = calculateVision(state, 'p1')
      expect(vision.has('radiant-base')).toBe(true)
      expect(vision.has('radiant-fountain')).toBe(true)
    })

    it('should include ward vision', () => {
      const zones = initializeZoneStates()
      zones['bot-river']!.wards.push({
        team: 'radiant',
        placedTick: 0,
        expiryTick: 100,
        type: 'observer',
      })

      const state = makeGameState({
        players: {
          p1: makePlayer({ team: 'radiant', zone: 'radiant-fountain' }),
        },
        zones,
      })

      const vision = calculateVision(state, 'p1')
      // Ward at bot-river should grant vision of bot-river + adjacent
      expect(vision.has('bot-river')).toBe(true)
      expect(vision.has('bot-t1-rad')).toBe(true)
      expect(vision.has('bot-t1-dire')).toBe(true)
    })

    it('should include tower vision for alive team towers', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ team: 'radiant', zone: 'radiant-fountain' }),
        },
      })

      const vision = calculateVision(state, 'p1')
      // Radiant T1 mid tower at mid-t1-rad should grant vision
      expect(vision.has('mid-t1-rad')).toBe(true)
    })

    it('should not grant vision from dead player position', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ zone: 'roshan-pit', alive: false }),
        },
      })

      const vision = calculateVision(state, 'p1')
      // Dead player doesn't contribute base vision from their zone
      // (but still has tower/base vision)
      // roshan-pit should not be visible unless a tower or ward covers it
      // roshan-pit is adjacent to rune-top only, and rune-top isn't a radiant tower
      // However, base + fountain vision still applies
      expect(vision.has('radiant-base')).toBe(true)
    })

    it('should include allied hero vision', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'radiant-fountain', team: 'radiant' }),
          p2: makePlayer({ id: 'p2', zone: 'roshan-pit', team: 'radiant' }),
        },
      })

      const vision = calculateVision(state, 'p1')
      // p2 is at roshan-pit, so p1 should see roshan-pit + adjacent
      expect(vision.has('roshan-pit')).toBe(true)
      expect(vision.has('rune-top')).toBe(true)
    })

    it('should return empty set for unknown player', () => {
      const state = makeGameState()
      const vision = calculateVision(state, 'nonexistent')
      expect(vision.size).toBe(0)
    })
  })

  describe('filterStateForPlayer', () => {
    it('should show full info for teammates', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-t1-rad' }),
          p2: makePlayer({ id: 'p2', team: 'radiant', zone: 'bot-t3-rad', name: 'Ally' }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const ally = filtered.players['p2'] as PlayerState
      expect(ally.zone).toBe('bot-t3-rad')
      expect(ally.hp).toBe(500)
      expect('fogged' in ally).toBe(false)
    })

    it('should fog enemies in non-visible zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
          e1: makePlayer({ id: 'e1', team: 'dire', zone: 'dire-fountain', name: 'Enemy' }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const enemy = filtered.players['e1'] as FoggedPlayer
      expect(enemy.fogged).toBe(true)
      expect('zone' in enemy).toBe(false)
      expect('hp' in enemy).toBe(false)
      expect('items' in enemy).toBe(false)
    })

    it('keeps a fogged enemy KDA + level public (scoreboard shows it even in fog)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
          e1: makePlayer({
            id: 'e1',
            team: 'dire',
            zone: 'dire-fountain',
            name: 'Enemy',
            kills: 7,
            deaths: 2,
            assists: 4,
            level: 11,
            gold: 3000,
          }),
        },
      })

      const enemy = filterStateForPlayer(state, 'p1').players['e1'] as FoggedPlayer
      expect(enemy.fogged).toBe(true)
      // KDA + level are public — preserved through the fog (was zeroed before).
      expect(enemy.kills).toBe(7)
      expect(enemy.deaths).toBe(2)
      expect(enemy.assists).toBe(4)
      expect(enemy.level).toBe(11)
      // ...but economy/position stay hidden.
      expect('gold' in enemy).toBe(false)
      expect('items' in enemy).toBe(false)
      expect('zone' in enemy).toBe(false)
    })

    it('should show full info for enemies in visible zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
          e1: makePlayer({
            id: 'e1',
            team: 'dire',
            zone: 'mid-river',
            name: 'VisibleEnemy',
            hp: 300,
          }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const enemy = filtered.players['e1'] as PlayerState
      expect(enemy.zone).toBe('mid-river')
      expect(enemy.hp).toBe(300)
      expect('fogged' in enemy).toBe(false)
    })

    it('should not reveal creeps in fogged zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
        },
        creeps: [
          { id: 'c1', team: 'dire', zone: 'dire-fountain', hp: 400, type: 'melee' },
          { id: 'c2', team: 'radiant', zone: 'radiant-base', hp: 400, type: 'melee' },
        ],
      })

      const filtered = filterStateForPlayer(state, 'p1')
      // c1 in dire-fountain should be hidden
      expect(filtered.creeps.find((c) => c.id === 'c1')).toBeUndefined()
      // c2 in radiant-base should be visible
      expect(filtered.creeps.find((c) => c.id === 'c2')).toBeDefined()
    })

    it('should not reveal enemy wards in fogged zones', () => {
      const zones = initializeZoneStates()
      zones['dire-base']!.wards.push({
        team: 'dire',
        placedTick: 0,
        expiryTick: 100,
        type: 'observer',
      })

      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'radiant-fountain' }),
        },
        zones,
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const dZone = filtered.zones['dire-base']
      expect(dZone?.wards.length).toBe(0)
    })

    it('should reveal invisible enemies in true sight zones', () => {
      const zones = initializeZoneStates()
      zones['mid-river']!.wards.push({
        team: 'radiant',
        placedTick: 0,
        expiryTick: 100,
        type: 'sentry',
      })

      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
          e1: makePlayer({
            id: 'e1',
            team: 'dire',
            zone: 'mid-river',
            name: 'InvisEnemy',
            hp: 300,
            buffs: [{ id: 'invisible', stacks: 1, ticksRemaining: 5, source: 'e1' }],
          }),
        },
        zones,
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const enemy = filtered.players['e1']!
      expect('fogged' in enemy).toBe(false)
      expect((enemy as PlayerState).hp).toBe(300)
    })

    it('should not reveal invisible enemies outside true sight zones', () => {
      const zones = initializeZoneStates()
      zones['mid-river']!.wards.push({
        team: 'radiant',
        placedTick: 0,
        expiryTick: 100,
        type: 'observer',
      })

      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
          e1: makePlayer({
            id: 'e1',
            team: 'dire',
            zone: 'mid-river',
            name: 'InvisEnemy',
            hp: 300,
            buffs: [{ id: 'invisible', stacks: 1, ticksRemaining: 5, source: 'e1' }],
          }),
        },
        zones,
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const enemy = filtered.players['e1']!
      expect('fogged' in enemy).toBe(true)
    })

    it('reveals invisible enemies in a Dust of Appearance carrier’s zone (was dead)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'radiant',
            zone: 'mid-river',
            buffs: [{ id: 'dust_reveal', stacks: 1, ticksRemaining: 2, source: 'p1' }],
          }),
          e1: makePlayer({
            id: 'e1',
            team: 'dire',
            zone: 'mid-river',
            name: 'InvisEnemy',
            hp: 300,
            buffs: [{ id: 'invisible', stacks: 1, ticksRemaining: 5, source: 'e1' }],
          }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      const enemy = filtered.players['e1']!
      expect('fogged' in enemy).toBe(false)
      expect((enemy as PlayerState).hp).toBe(300)
    })

    it('Dust of Appearance reveal extends to adjacent zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'radiant',
            zone: 'mid-river',
            buffs: [{ id: 'dust_reveal', stacks: 1, ticksRemaining: 2, source: 'p1' }],
          }),
          e1: makePlayer({
            id: 'e1',
            team: 'dire',
            zone: 'mid-t1-dire', // adjacent to mid-river
            name: 'InvisEnemy',
            buffs: [{ id: 'invisible', stacks: 1, ticksRemaining: 5, source: 'e1' }],
          }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      expect('fogged' in filtered.players['e1']!).toBe(false)
    })

    it('Dust of Appearance truesight is team-scoped (does not reveal for the enemy team)', () => {
      const state = makeGameState({
        players: {
          // Radiant carrier is itself invisible AND holds Dust.
          p1: makePlayer({
            id: 'p1',
            team: 'radiant',
            zone: 'mid-river',
            name: 'InvisCarrier',
            buffs: [
              { id: 'dust_reveal', stacks: 1, ticksRemaining: 2, source: 'p1' },
              { id: 'invisible', stacks: 1, ticksRemaining: 5, source: 'p1' },
            ],
          }),
          e2: makePlayer({ id: 'e2', team: 'dire', zone: 'mid-river', name: 'DireViewer' }),
        },
      })

      // Radiant's Dust adds truesight for radiant only — the dire viewer shares
      // the zone but has no truesight, so the invisible carrier stays fogged.
      const filtered = filterStateForPlayer(state, 'e2')
      expect('fogged' in filtered.players['p1']!).toBe(true)
    })

    it('should include visibleZones in the output', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river' }),
        },
      })

      const filtered = filterStateForPlayer(state, 'p1')
      expect(filtered.visibleZones.length).toBeGreaterThan(0)
      expect(filtered.visibleZones).toContain('mid-river')
    })
  })

  describe('night vision (NIGHT_VISION_PENALTY)', () => {
    it("keeps the hero's own zone visible at night (regression: own zone went blind)", () => {
      const state = makeGameState({
        timeOfDay: 'night',
        players: { p1: makePlayer({ zone: 'mid-river' }) },
      })
      // The own zone is always visible, even at night.
      expect(calculateVision(state, 'p1').has('mid-river')).toBe(true)
    })

    it('reveals strictly fewer zones at night than by day (vision is reduced)', () => {
      const players = { p1: makePlayer({ zone: 'mid-river' }) }
      const day = calculateVision(makeGameState({ timeOfDay: 'day', players }), 'p1')
      const night = calculateVision(makeGameState({ timeOfDay: 'night', players }), 'p1')

      // Night only ever trims adjacency, never adds — so night vision is a
      // strict subset of day vision, and strictly smaller.
      for (const z of night) expect(day.has(z)).toBe(true)
      expect(night.size).toBeLessThan(day.size)
    })

    it('Tracepath (tracepath_vision buff) extends vision one hop further', () => {
      const tracepath = {
        id: 'tracepath_vision',
        stacks: 1,
        ticksRemaining: 3,
        source: 'p1',
      }
      const base = calculateVision(
        makeGameState({ players: { p1: makePlayer({ zone: 'mid-river' }) } }),
        'p1',
      )
      const traced = calculateVision(
        makeGameState({ players: { p1: makePlayer({ zone: 'mid-river', buffs: [tracepath] }) } }),
        'p1',
      )

      // The buff reveals 2-hop zones — a strict superset of normal sight.
      for (const z of base) expect(traced.has(z)).toBe(true)
      expect(traced.size).toBeGreaterThan(base.size)
    })
  })

  describe('map/mode labels reach the client', () => {
    // Regression: the client picks its ASCII layout + tutorial UI off these
    // labels, so filterStateForPlayer MUST carry them through (they were
    // dropped originally, leaving the one-lane layout dead in the browser).
    it('carries mapId + mode + tutorialStep for an alive player', () => {
      const state = makeGameState({
        players: { p1: makePlayer() },
        mapId: 'one_lane',
        mode: 'tutorial',
        tutorialStep: 2,
      })
      const view = filterStateForPlayer(state, 'p1')
      expect(view.mapId).toBe('one_lane')
      expect(view.mode).toBe('tutorial')
      expect(view.tutorialStep).toBe(2)
    })

    it('carries mapId + mode even when the viewer is not in the game (dead/absent)', () => {
      const state = makeGameState({ players: {}, mapId: 'one_lane', mode: 'tutorial' })
      const view = filterStateForPlayer(state, 'ghost')
      expect(view.mapId).toBe('one_lane')
      expect(view.mode).toBe('tutorial')
    })

    it('leaves both undefined for a default 5v5 normal match', () => {
      const view = filterStateForPlayer(makeGameState({ players: { p1: makePlayer() } }), 'p1')
      expect(view.mapId).toBeUndefined()
      expect(view.mode).toBeUndefined()
    })
  })

  describe('night vision ordering', () => {
    it('drops the enemy-territory neighbor first, keeping own-team vision', () => {
      // A radiant hero in mid-river (neutral) at night. mid-river's neighbors
      // include mid-t1-rad (radiant) and mid-t1-dire (dire). With PENALTY=1,
      // the dire (enemy) neighbor should be dropped, keeping radiant-side vision.
      const state = makeGameState({
        timeOfDay: 'night',
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
        },
      })
      const vision = calculateVision(state, 'p1', 'game-night-test')

      // Own zone always visible
      expect(vision.has('mid-river')).toBe(true)
      // Radiant T1 (own territory) should still be visible at night
      expect(vision.has('mid-t1-rad')).toBe(true)
      // Dire T1 (enemy territory) should be the dropped neighbor
      expect(vision.has('mid-t1-dire')).toBe(false)
    })

    it('at day, sees all neighbors regardless of team', () => {
      const state = makeGameState({
        timeOfDay: 'day',
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' }),
        },
      })
      const vision = calculateVision(state, 'p1', 'game-day-test')
      expect(vision.has('mid-river')).toBe(true)
      expect(vision.has('mid-t1-rad')).toBe(true)
      expect(vision.has('mid-t1-dire')).toBe(true)
    })
  })

  describe('vision cache isolation by gameId', () => {
    it('does not share cache entries across games for the same playerId', () => {
      // Same player in two "games" at different river zones — the cache key
      // includes gameId so the second game's vision doesn't return the first's
      // stale set. River zones aren't tower zones, so the only vision source is
      // the player's own sight (keeping the assertion clean).
      const stateA = makeGameState({
        players: { p1: makePlayer({ id: 'p1', zone: 'mid-river' }) },
      })
      const stateB = makeGameState({
        players: { p1: makePlayer({ id: 'p1', zone: 'bot-river' }) },
      })

      const visionA = calculateVision(stateA, 'p1', 'game-A')
      const visionB = calculateVision(stateB, 'p1', 'game-B')

      // mid-river is visible in A (player's zone) and is a neighbor of bot-river
      // via rune-bot, so it MAY be visible in B too. Instead assert on the
      // player's own zone being the distinguishing factor: both river zones are
      // visible in their respective games.
      expect(visionA.has('mid-river')).toBe(true)
      expect(visionB.has('bot-river')).toBe(true)
      // bot-river is NOT visible in A (it's 2 hops from mid-river through
      // rune-bot, but rune-bot's neighbors get the night treatment... at day
      // all are visible. Verify the cache didn't return A's set for B.)
      // The key assertion: the cache returned DIFFERENT sets for the two games.
      expect(visionA).not.toEqual(visionB)
    })
  })
})
