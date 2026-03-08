import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import {
  resolveActions,
  validateAction,
  type PlayerAction,
} from '../../../server/game/engine/ActionResolver'
import type { GameState, PlayerState } from '../../../shared/types/game'
import { initializeZoneStates, initializeTowers } from '../../../server/game/map/zones'
import { initializeRoshan } from '../../../server/game/map/spawner'

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
    buybackCost: 100,
    talents: {
      tier10: null,
      tier15: null,
      tier20: null,
      tier25: null,
    },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

describe('ActionResolver', () => {
  describe('validateAction', () => {
    it('should allow moving to adjacent zone', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'mid-t1-rad' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'mid-t2-rad' },
      })
      expect(error).toBeNull()
    })

    it('should reject moving to non-adjacent zone', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'mid-t1-rad' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'bot-t1-rad' },
      })
      expect(error).toBe('Cannot move to non-adjacent zone')
    })

    it('should reject actions from dead players', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ alive: false }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'mid-t2-rad' },
      })
      expect(error).toBe('Player is dead')
    })

    it('should reject casting on cooldown', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ cooldowns: { q: 3, w: 0, e: 0, r: 0 } }),
        },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q' },
      })
      expect(error).toBe('Ability on cooldown')
    })

    it('should reject casting without enough mana', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ mp: 10 }) }, // Echo Q costs 60
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'cast', ability: 'q' },
      })
      expect(error).toBe('Not enough mana')
    })

    it('should reject buying outside shop', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'mid-river' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'buy', item: 'sword' },
      })
      expect(error).toBe('Not in a shop zone')
    })

    it('should allow buying in fountain (shop zone)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'radiant-fountain' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'buy', item: 'sword' },
      })
      expect(error).toBeNull()
    })

    it('should reject move while stunned', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 2, source: 'e1' }],
          }),
        },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'mid-t2-rad' },
      })
      expect(error).toBe('Cannot move while rooted or stunned')
    })

    it('should allow chat from any state', () => {
      const state = makeGameState({
        players: { p1: makePlayer() },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'chat', channel: 'all', message: 'gg' },
      })
      expect(error).toBeNull()
    })
  })

  describe('resolveActions', () => {
    it('should move players to new zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'move', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      expect(result.state.players['p1']!.zone).toBe('mid-river')
    })

    it('should resolve multiple moves simultaneously', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-rad', team: 'radiant' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-t1-dire', team: 'dire' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'move', zone: 'mid-river' } },
        { playerId: 'p2', command: { type: 'move', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      // Both should be in mid-river — zones hold multiple units
      expect(result.state.players['p1']!.zone).toBe('mid-river')
      expect(result.state.players['p2']!.zone).toBe('mid-river')
    })

    it('should track hero attackers for tower AI', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'radiant' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river', team: 'dire', name: 'Enemy' }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      expect(result.heroAttackers.get('p1')).toBe('p2')
    })

    it('should generate damage events on attack', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'radiant', heroId: 'echo' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river', team: 'dire', name: 'Enemy', hp: 500 }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      const dmgEvents = result.events.filter((e) => e._tag === 'damage')
      expect(dmgEvents.length).toBeGreaterThan(0)
      expect(dmgEvents[0]!.sourceId).toBe('p1')
      expect(dmgEvents[0]!.targetId).toBe('p2')
    })

    it('should tick down cooldowns each tick', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', cooldowns: { q: 3, w: 1, e: 0, r: 5 } }),
        },
      })

      const result = Effect.runSync(resolveActions(state, []))
      const cd = result.state.players['p1']!.cooldowns
      expect(cd.q).toBe(2)
      expect(cd.w).toBe(0)
      expect(cd.e).toBe(0)
      expect(cd.r).toBe(4)
    })

    it('should preserve buffs without ticking them (buff ticking is done in GameLoop)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            buffs: [
              { id: 'shield', stacks: 1, ticksRemaining: 1, source: 'p2' },
              { id: 'buff', stacks: 1, ticksRemaining: 3, source: 'p2' },
            ],
          }),
        },
      })

      const result = Effect.runSync(resolveActions(state, []))
      const buffs = result.state.players['p1']!.buffs
      // Buffs are NOT ticked down in ActionResolver — that's handled by tickAllBuffs in GameLoop
      expect(buffs.length).toBe(2)
      expect(buffs[0]!.ticksRemaining).toBe(1)
      expect(buffs[1]!.ticksRemaining).toBe(3)
    })

    it('should place wards in valid zones', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'radiant',
            items: ['observer_ward', null, null, null, null, null],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'ward', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      const wardEvents = result.events.filter((e) => e._tag === 'ward_placed')
      expect(wardEvents.length).toBe(1)
    })

    it('should place sentry wards for true sight', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'radiant',
            items: ['sentry_ward', null, null, null, null, null],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'ward', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      const wardEvents = result.events.filter((e) => e._tag === 'ward_placed')
      expect(wardEvents.length).toBe(1)
      expect(wardEvents[0]!.wardType).toBe('sentry')
      expect(result.state.zones['mid-river']!.wards[0]!.type).toBe('sentry')
    })

    it('should store ward type correctly for observer wards', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'radiant',
            items: ['observer_ward', null, null, null, null, null],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'ward', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      expect(result.state.zones['mid-river']!.wards[0]!.type).toBe('observer')
    })

    it('should use different durations for sentry and observer wards', () => {
      const observerState = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'radiant',
            items: ['observer_ward', null, null, null, null, null],
          }),
        },
      })

      const sentryState = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'radiant',
            items: ['sentry_ward', null, null, null, null, null],
          }),
        },
      })

      const tick = 10

      const observerResult = Effect.runSync(
        resolveActions({ ...observerState, tick }, [
          { playerId: 'p1', command: { type: 'ward', zone: 'mid-river' } },
        ]),
      )

      const sentryResult = Effect.runSync(
        resolveActions({ ...sentryState, tick }, [
          { playerId: 'p1', command: { type: 'ward', zone: 'mid-river' } },
        ]),
      )

      const observerWard = observerResult.state.zones['mid-river']!.wards[0]!
      const sentryWard = sentryResult.state.zones['mid-river']!.wards[0]!

      expect(observerWard.type).toBe('observer')
      expect(sentryWard.type).toBe('sentry')
      expect(sentryWard.expiryTick).toBeLessThan(observerWard.expiryTick)
    })

    it('should apply stun buff when Skull Basher bash procs', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'radiant',
            items: ['skull_basher', null, null, null, null, null],
          }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river', team: 'dire', name: 'Enemy', hp: 500 }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
      ]

      let foundStun = false
      for (let i = 0; i < 50; i++) {
        const result = Effect.runSync(resolveActions(state, actions))
        const target = result.state.players['p2']
        const hasStun = target?.buffs.some((b) => b.id === 'stun') ?? false
        if (hasStun) {
          foundStun = true
          break
        }
      }

      expect(foundStun).toBe(true)
    })

    it('should not mutate player object when adding buffs from Linken refresh', () => {
      const originalBuffs: any[] = []
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            items: ['linkens_sphere', null, null, null, null, null],
            buffs: [],
          }),
        },
      })

      originalBuffs.push(state.players['p1']!.buffs)

      const result = Effect.runSync(resolveActions(state, []))

      expect(result.state.players['p1']!.buffs).not.toBe(originalBuffs[0])
      expect(result.state.players['p1']!.buffs).toHaveLength(1)
      expect(result.state.players['p1']!.buffs[0]!.id).toBe('spellblock')
    })

    it('should cancel TP channeling when player moves', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-t1-rad',
            buffs: [
              { id: 'tp_channeling', stacks: 1, ticksRemaining: 2, source: 'town_portal_scroll' },
              {
                id: 'tp_destination',
                stacks: 1,
                ticksRemaining: 3,
                source: 'town_portal_scroll',
                destination: 'radiant-fountain',
              },
            ],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'move', zone: 'mid-t2-rad' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      expect(result.state.players['p1']!.zone).toBe('mid-t2-rad')
      expect(result.state.players['p1']!.buffs).toHaveLength(0)

      const tpCancelEvents = result.events.filter((e) => e._tag === 'teleport_cancelled')
      expect(tpCancelEvents.length).toBe(1)
      expect(tpCancelEvents[0]!.reason).toBe('movement')
    })

    it('should cancel TP channeling when player takes damage', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'radiant',
            buffs: [
              { id: 'tp_channeling', stacks: 1, ticksRemaining: 2, source: 'town_portal_scroll' },
              {
                id: 'tp_destination',
                stacks: 1,
                ticksRemaining: 3,
                source: 'town_portal_scroll',
                destination: 'radiant-fountain',
              },
            ],
          }),
          p2: makePlayer({
            id: 'p2',
            zone: 'mid-river',
            team: 'dire',
            name: 'Enemy',
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p2', command: { type: 'attack', target: { kind: 'hero', name: 'Player1' } } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      expect(result.state.players['p1']!.buffs).toHaveLength(0)

      const tpCancelEvents = result.events.filter((e) => e._tag === 'teleport_cancelled')
      expect(tpCancelEvents.length).toBe(1)
      expect(tpCancelEvents[0]!.reason).toBe('damage')
    })

    it('should not cancel TP if player has no tp_channeling buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-t1-rad',
            buffs: [{ id: 'some_other_buff', stacks: 1, ticksRemaining: 2, source: 'test' }],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'move', zone: 'mid-t2-rad' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      expect(result.state.players['p1']!.zone).toBe('mid-t2-rad')
      expect(result.state.players['p1']!.buffs).toHaveLength(1)

      const tpCancelEvents = result.events.filter((e) => e._tag === 'teleport_cancelled')
      expect(tpCancelEvents.length).toBe(0)
    })
  })

  describe('glyph', () => {
    it('should make all friendly towers invulnerable when glyph is used', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant' }),
        },
      })

      const actions: PlayerAction[] = [{ playerId: 'p1', command: { type: 'glyph' } }]

      const result = Effect.runSync(resolveActions(state, actions))

      const radiantTowers = result.state.towers.filter((t) => t.team === 'radiant')
      const direTowers = result.state.towers.filter((t) => t.team === 'dire')

      for (const tower of radiantTowers) {
        expect(tower.invulnerable).toBe(true)
      }
      for (const tower of direTowers) {
        expect(tower.invulnerable).toBe(false)
      }

      expect(result.state.teams.radiant.glyphUsedTick).toBe(state.tick)
      expect(result.state.teams.dire.glyphUsedTick).toBeNull()

      const glyphEvents = result.events.filter((e) => e._tag === 'glyph_used')
      expect(glyphEvents.length).toBe(1)
      expect(glyphEvents[0]!.team).toBe('radiant')
    })

    it('should block attack on invulnerable tower', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-t1-dire',
            team: 'radiant',
          }),
        },
        towers: initializeTowers().map((t) =>
          t.zone === 'mid-t1-dire' ? { ...t, invulnerable: true } : t,
        ),
      })

      const actions: PlayerAction[] = [
        {
          playerId: 'p1',
          command: { type: 'attack', target: { kind: 'tower', zone: 'mid-t1-dire' } },
        },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      const tower = result.state.towers.find((t) => t.zone === 'mid-t1-dire')
      expect(tower?.hp).toBe(tower?.maxHp)

      const invulnEvents = result.events.filter((e) => e._tag === 'tower_invulnerable')
      expect(invulnEvents.length).toBe(1)
      expect(invulnEvents[0]!.zone).toBe('mid-t1-dire')
    })

    it('should reject glyph when on cooldown', () => {
      const state = makeGameState({
        tick: 100,
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant' }),
        },
        teams: {
          radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: 50 },
          dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
        },
      })

      const actions: PlayerAction[] = [{ playerId: 'p1', command: { type: 'glyph' } }]

      const result = Effect.runSync(resolveActions(state, actions))

      const radiantTowers = result.state.towers.filter((t) => t.team === 'radiant')
      for (const tower of radiantTowers) {
        expect(tower.invulnerable).toBe(false)
      }

      const cooldownEvents = result.events.filter((e) => e._tag === 'glyph_on_cooldown')
      expect(cooldownEvents.length).toBe(1)
      expect(cooldownEvents[0]!.playerId).toBe('p1')
      expect(cooldownEvents[0]!.remainingTicks).toBeGreaterThan(0)
    })
  })
})
