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
import { initializeAncients } from '../../../server/game/engine/AncientSystem'
import { tickAllBuffs } from '../../../server/game/heroes/_base'
// Register echo so its Q resolver runs (the spell-block tests cast a real spell).
import '../../../server/game/heroes/echo'

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
    ancients: initializeAncients(),
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

    it("should reject all actions while cycloned (Eul's)", () => {
      const cyclonedState = makeGameState({
        players: {
          p1: makePlayer({
            zone: 'mid-t1-rad',
            buffs: [{ id: 'cyclone', stacks: 1, ticksRemaining: 2, source: 'euls_scepter' }],
          }),
        },
      })
      for (const command of [
        { type: 'move', zone: 'mid-t2-rad' },
        { type: 'attack', target: { kind: 'hero', name: 'x' } },
        { type: 'cast', ability: 'q' },
      ] as const) {
        expect(validateAction(cyclonedState, { playerId: 'p1', command })).toBe(
          'Cannot act while cycloned',
        )
      }
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

    it('should reject casting without enough mana via the resolver rejected channel', () => {
      // Mana is no longer validated in validateAction — per-hero scaled costs
      // live in the resolver files, so the resolver's InsufficientManaError
      // is authoritative and surfaced through resolveActions' rejected list.
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            mp: 10,
            maxMp: 280,
            hp: 550,
            maxHp: 550,
            zone: 'mid-river',
            team: 'radiant',
          }),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            zone: 'mid-river',
            team: 'dire',
            hp: 550,
            maxHp: 550,
          }),
        },
      })
      expect(
        validateAction(state, { playerId: 'p1', command: { type: 'cast', ability: 'q' } }),
      ).toBeNull()

      const result = Effect.runSync(
        resolveActions(state, [
          {
            playerId: 'p1',
            command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
          },
        ]),
      )
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.playerId).toBe('p1')
      expect(result.rejected[0]!.reason).toMatch(/mana/i)
      // Target untouched, no mana spent, no cooldown set
      expect(result.state.players['p2']!.hp).toBe(550)
      expect(result.state.players['p1']!.mp).toBe(10)
      expect(result.state.players['p1']!.cooldowns.q).toBe(0)
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
      const originalBuffs: BuffState[][] = []
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

  describe('use item phase', () => {
    it('validates use commands (ownership, active, cooldown)', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            items: ['vanguard', 'blade_mail', null, null, null, null],
            buffs: [
              { id: 'item_cd_blade_mail', stacks: 1, ticksRemaining: 5, source: 'blade_mail' },
            ],
          }),
        },
      })

      expect(
        validateAction(state, {
          playerId: 'p1',
          command: { type: 'use', item: 'black_king_bar' },
        }),
      ).toBe('Item not owned')
      expect(
        validateAction(state, { playerId: 'p1', command: { type: 'use', item: 'vanguard' } }),
      ).toBe('Item has no active ability')
      expect(
        validateAction(state, { playerId: 'p1', command: { type: 'use', item: 'blade_mail' } }),
      ).toBe('Item on cooldown')
    })

    it('consumes a healing salve and regenerates HP on following ticks', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            hp: 300,
            maxHp: 550,
            mp: 280,
            maxMp: 280,
            items: ['healing_salve', null, null, null, null, null],
          }),
        },
      })

      const tick1 = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'use', item: 'healing_salve' } },
        ]),
      )
      const p1 = tick1.state.players['p1']!
      expect(p1.items[0]).toBeNull()
      expect(p1.buffs.some((b) => b.id === 'healing_salve_regen')).toBe(true)
      expect(
        tick1.events.some(
          (e) =>
            e._tag === 'ability_used' &&
            e.playerId === 'p1' &&
            e.abilityId === 'healing_salve_active',
        ),
      ).toBe(true)
      // Regen kicks in on subsequent ticks, not the cast tick
      expect(p1.hp).toBe(300)

      const tick2 = Effect.runSync(resolveActions(tick1.state, []))
      expect(tick2.state.players['p1']!.hp).toBe(350)
    })

    it('town portal scroll channels and then teleports to the fountain', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            zone: 'mid-river',
            maxHp: 550,
            hp: 550,
            mp: 280,
            maxMp: 280,
            items: ['town_portal_scroll', null, null, null, null, null],
          }),
        },
      })

      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'use', item: 'town_portal_scroll' } },
        ]),
      )
      const p1 = result.state.players['p1']!
      expect(p1.items[0]).toBeNull()
      expect(p1.buffs.some((b) => b.id === 'tp_channeling')).toBe(true)
      const dest = p1.buffs.find((b) => b.id === 'tp_destination')
      expect(dest?.destination).toBe('radiant-fountain')

      // GameLoop ticks buffs each tick; teleport completes when channel finishes
      let channeled = result.state
      for (let i = 0; i < 3; i++) {
        channeled = tickAllBuffs(channeled)
      }
      expect(channeled.players['p1']!.zone).toBe('radiant-fountain')
    })

    it('blink module moves the player to an adjacent zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            zone: 'mid-t1-rad',
            items: ['blink_module', null, null, null, null, null],
          }),
        },
      })

      const result = Effect.runSync(
        resolveActions(state, [
          {
            playerId: 'p1',
            command: { type: 'use', item: 'blink_module', target: 'mid-river' },
          },
        ]),
      )
      const p1 = result.state.players['p1']!
      expect(p1.zone).toBe('mid-river')
      // Not a consumable — stays in inventory, goes on cooldown
      expect(p1.items[0]).toBe('blink_module')
      expect(p1.buffs.some((b) => b.id === 'item_cd_blink_module')).toBe(true)
    })

    it('black king bar applies the magic_immune buff', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            hp: 750,
            maxHp: 750,
            items: ['black_king_bar', null, null, null, null, null],
          }),
        },
      })

      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'use', item: 'black_king_bar' } },
        ]),
      )
      const p1 = result.state.players['p1']!
      const immune = p1.buffs.find((b) => b.id === 'magic_immune')
      expect(immune).toBeDefined()
      expect(immune!.ticksRemaining).toBe(4)
      expect(p1.buffs.some((b) => b.id === 'item_cd_black_king_bar')).toBe(true)
    })

    it('ghost scepter buff blocks physical attack damage on later ticks', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'radiant' }),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            zone: 'mid-river',
            team: 'dire',
            hp: 550,
            maxHp: 550,
            mp: 380,
            maxMp: 380,
            items: ['ghost_scepter', null, null, null, null, null],
          }),
        },
      })

      const tick1 = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p2', command: { type: 'use', item: 'ghost_scepter' } },
        ]),
      )
      expect(tick1.state.players['p2']!.buffs.some((b) => b.id === 'ghost_form')).toBe(true)

      const tick2 = Effect.runSync(
        resolveActions(tick1.state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
        ]),
      )
      expect(tick2.state.players['p2']!.hp).toBe(550)
      const dmgEvents = tick2.events.filter((e) => e._tag === 'damage' && e.targetId === 'p2')
      expect(dmgEvents.every((e) => e.amount === 0)).toBe(true)
    })

    it('blade mail buff reflects attack damage back to the attacker', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'radiant',
            hp: 550,
            maxHp: 550,
          }),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            zone: 'mid-river',
            team: 'dire',
            hp: 650,
            maxHp: 650,
            items: ['blade_mail', null, null, null, null, null],
          }),
        },
      })

      const tick1 = Effect.runSync(
        resolveActions(state, [{ playerId: 'p2', command: { type: 'use', item: 'blade_mail' } }]),
      )
      expect(tick1.state.players['p2']!.buffs.some((b) => b.id === 'blade_mail')).toBe(true)

      const tick2 = Effect.runSync(
        resolveActions(tick1.state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'Enemy' } } },
        ]),
      )

      const physical = tick2.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'p2' && e.damageType === 'physical',
      )
      expect(physical).toBeDefined()
      expect(physical!._tag === 'damage' && physical!.amount).toBeGreaterThan(0)

      const reflected = tick2.events.find(
        (e) =>
          e._tag === 'damage' &&
          e.sourceId === 'p2' &&
          e.targetId === 'p1' &&
          e.damageType === 'pure',
      )
      expect(reflected).toBeDefined()
      const reflectAmount = reflected!._tag === 'damage' ? reflected!.amount : 0
      expect(reflectAmount).toBeGreaterThan(0)
      expect(tick2.state.players['p1']!.hp).toBe(550 - reflectAmount)
    })

    it('rejects an invalid item use without changing state or emitting events', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            zone: 'mid-t1-rad',
            items: ['blink_module', null, null, null, null, null],
          }),
        },
      })

      // dire-fountain is not adjacent to mid-t1-rad — useItem fails
      const result = Effect.runSync(
        resolveActions(state, [
          {
            playerId: 'p1',
            command: { type: 'use', item: 'blink_module', target: 'dire-fountain' },
          },
        ]),
      )
      const p1 = result.state.players['p1']!
      expect(p1.zone).toBe('mid-t1-rad')
      expect(p1.items[0]).toBe('blink_module')
      expect(result.events.filter((e) => e._tag === 'ability_used')).toHaveLength(0)
    })
  })

  describe('ancient attacks', () => {
    function stateWithVulnerableDireAncient(playerZone: string, vulnerable = true): GameState {
      const ancients = initializeAncients()
      return makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'radiant', zone: playerZone }) },
        ancients: { ...ancients, dire: { ...ancients.dire, vulnerable } },
      })
    }

    it('damages the vulnerable enemy ancient from the enemy base', () => {
      const state = stateWithVulnerableDireAncient('dire-base')
      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'ancient' } } },
        ]),
      )

      expect(result.state.ancients.dire.hp).toBeLessThan(state.ancients.dire.hp)
      const dmg = result.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'ancient_dire' && e.sourceId === 'p1',
      )
      expect(dmg).toBeDefined()
      // Counts as structure damage on the scoreboard
      expect(result.state.players['p1']!.towerDamageDealt).toBeGreaterThan(0)
    })

    it('does not damage an invulnerable ancient', () => {
      const state = stateWithVulnerableDireAncient('dire-base', false)
      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'ancient' } } },
        ]),
      )

      expect(result.state.ancients.dire.hp).toBe(state.ancients.dire.hp)
      expect(result.events.filter((e) => e._tag === 'damage')).toHaveLength(0)
    })

    it('requires the attacker to be in the enemy base zone', () => {
      const state = stateWithVulnerableDireAncient('mid-river')
      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'ancient' } } },
        ]),
      )

      expect(result.state.ancients.dire.hp).toBe(state.ancients.dire.hp)
      expect(result.events.filter((e) => e._tag === 'damage')).toHaveLength(0)
    })
  })

  describe('spell block (Linken / Firewall)', () => {
    // echo Q is a single-target (targetType 'hero') damage spell. hp/maxHp/mp are
    // set to echo's exact base (550/280) so the maxHp-sync phase is a no-op and
    // the spell's HP change isn't recomputed away.
    const castQ = (state: GameState) =>
      Effect.runSync(
        resolveActions(state, [
          {
            playerId: 'p1',
            command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
          },
        ]),
      )
    const echoStats = { heroId: 'echo', hp: 550, maxHp: 550, mp: 280, maxMp: 280 } as const
    const enemy = (buffs: PlayerState['buffs']) =>
      makePlayer({ id: 'p2', name: 'Enemy', team: 'dire', zone: 'mid-river', ...echoStats, buffs })
    const caster = () => makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river', ...echoStats })

    it('control: the spell lands on an unbuffed target', () => {
      const state = makeGameState({ players: { p1: caster(), p2: enemy([]) } })
      expect(castQ(state).state.players['p2']!.hp).toBeLessThan(550)
    })

    it("Linken's Sphere blocks the spell, spares the target, and spends the charge", () => {
      const state = makeGameState({
        players: {
          p1: caster(),
          p2: enemy([
            { id: 'spellblock', stacks: 1, ticksRemaining: 12, source: 'linkens_sphere' },
          ]),
        },
      })
      const result = castQ(state)
      expect(result.state.players['p2']!.hp).toBe(550) // unharmed
      expect(result.state.players['p2']!.buffs.find((b) => b.id === 'spellblock')!.stacks).toBe(0)
      expect(result.state.players['p1']!.mp).toBeLessThan(280) // caster still paid
      expect(result.state.players['p1']!.cooldowns.q).toBeGreaterThan(0)
      expect(result.events.some((e) => e._tag === 'spell_blocked')).toBe(true)
    })

    it('Firewall item block is a one-shot (removed on use)', () => {
      const state = makeGameState({
        players: {
          p1: caster(),
          p2: enemy([
            { id: 'firewall_block', stacks: 1, ticksRemaining: 30, source: 'firewall_item' },
          ]),
        },
      })
      const result = castQ(state)
      expect(result.state.players['p2']!.hp).toBe(550)
      expect(result.state.players['p2']!.buffs.some((b) => b.id === 'firewall_block')).toBe(false)
    })

    it('a spent (stacks 0) spellblock does NOT block', () => {
      const state = makeGameState({
        players: {
          p1: caster(),
          p2: enemy([{ id: 'spellblock', stacks: 0, ticksRemaining: 8, source: 'linkens_sphere' }]),
        },
      })
      const result = castQ(state)
      expect(result.state.players['p2']!.hp).toBeLessThan(550) // spell lands
      expect(result.events.some((e) => e._tag === 'spell_blocked')).toBe(false)
    })
  })
})
