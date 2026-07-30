import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import {
  resolveActions,
  validateAction,
  type PlayerAction,
} from '~~/server/game/engine/ActionResolver'
import type { GameState, PlayerState } from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { SILT_DWELLERS } from '~~/shared/constants/balance'
import { HEROES } from '~~/shared/constants/heroes'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { initializeTenant } from '~~/server/game/map/spawner'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'
import { tickAllBuffs } from '~~/server/game/heroes/_base'
// Register echo so its Q resolver runs (the spell-block tests cast a real spell).
import '../../../server/game/heroes/echo'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player1',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
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
    iceDamageDealt: 0,
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
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    ancients: initializeAncients(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

describe('ActionResolver', () => {
  describe('validateAction', () => {
    it('should allow moving to adjacent zone', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'mid-t1-chaff' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'mid-t2-chaff' },
      })
      expect(error).toBeNull()
    })

    it('should allow moving to a distant zone (auto-path walks one hop per tick)', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ zone: 'mid-t1-chaff' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'bot-t1-chaff' },
      })
      expect(error).toBeNull()
    })

    it('should reject moving to a zone outside the game map', () => {
      // A subset map (one-lane style): only these zones exist in the live state,
      // so a globally-valid zone off this map has no path and must be rejected.
      const allZones = initializeZoneStates()
      const subset = Object.fromEntries(
        Object.entries(allZones).filter(([id]) =>
          ['chaff-fountain', 'chaff-base', 'mid-t3-chaff', 'mid-t2-chaff', 'mid-t1-chaff'].includes(
            id,
          ),
        ),
      )
      const state = makeGameState({
        zones: subset,
        players: { p1: makePlayer({ zone: 'mid-t1-chaff' }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'bot-t1-chaff' },
      })
      expect(error).toBe('No path to that zone')
    })

    it('should reject actions from dead players', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ alive: false }) },
      })
      const error = validateAction(state, {
        playerId: 'p1',
        command: { type: 'move', zone: 'mid-t2-chaff' },
      })
      expect(error).toBe('Player is dead')
    })

    it("should reject all actions while cycloned (Eul's)", () => {
      const cyclonedState = makeGameState({
        players: {
          p1: makePlayer({
            zone: 'mid-t1-chaff',
            buffs: [{ id: 'cyclone', stacks: 1, ticksRemaining: 2, source: 'euls_scepter' }],
          }),
        },
      })
      for (const command of [
        { type: 'move', zone: 'mid-t2-chaff' },
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
      // Concrete rejection (brief quick win #1): ability name + ticks left + ready tick.
      expect(error).toContain('on cooldown')
      expect(error).toMatch(/3 ticks left/)
      expect(error).toMatch(/ready T\d+/)
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
            team: 'chaff',
          }),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            zone: 'mid-river',
            team: 'audit',
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
        players: { p1: makePlayer({ zone: 'chaff-fountain' }) },
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
        command: { type: 'move', zone: 'mid-t2-chaff' },
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
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-chaff' }),
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
          p1: makePlayer({ id: 'p1', zone: 'mid-t1-chaff', team: 'chaff' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-t1-audit', team: 'audit' }),
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

    it('should track hero attackers for ice AI', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'chaff' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river', team: 'audit', name: 'Enemy' }),
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
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'chaff', heroId: 'echo' }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river', team: 'audit', name: 'Enemy', hp: 500 }),
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

    it('awards the neutral bounty (gold + xp) and emits neutral_killed on a jungle kill', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'chaff',
            heroId: 'echo',
            gold: 600,
            xp: 0,
          }),
        },
        neutrals: [{ id: 'n1', zone: 'mid-river', type: 'stub', hp: 1, maxHp: 250, alive: true }],
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'attack', target: { kind: 'neutral', index: 0 } } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      const killer = result.state.players['p1']!
      expect(killer.gold).toBe(600 + SILT_DWELLERS.stub.gold) // 600 + 20
      expect(killer.xp).toBe(SILT_DWELLERS.stub.xp) // 25
      // dead neutral is pruned from the array (or left flagged not-alive)
      const n1 = result.state.neutrals?.find((n) => n.id === 'n1')
      expect(n1?.alive ?? false).toBe(false)
      expect(result.events.some((e) => e._tag === 'neutral_killed' && e.playerId === 'p1')).toBe(
        true,
      )
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
            team: 'chaff',
            items: ['camtap', null, null, null, null, null],
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
            team: 'chaff',
            items: ['sniffer', null, null, null, null, null],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'ward', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      const wardEvents = result.events.filter((e) => e._tag === 'ward_placed')
      expect(wardEvents.length).toBe(1)
      expect(wardEvents[0]!.wardType).toBe('sniffer')
      expect(result.state.zones['mid-river']!.wards[0]!.type).toBe('sniffer')
    })

    it('should store ward type correctly for observer wards', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'chaff',
            items: ['camtap', null, null, null, null, null],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'ward', zone: 'mid-river' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))
      expect(result.state.zones['mid-river']!.wards[0]!.type).toBe('camtap')
    })

    it('should use different durations for sentry and observer wards', () => {
      const observerState = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'chaff',
            items: ['camtap', null, null, null, null, null],
          }),
        },
      })

      const sentryState = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'chaff',
            items: ['sniffer', null, null, null, null, null],
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

      const camtapWard = observerResult.state.zones['mid-river']!.wards[0]!
      const snifferWard = sentryResult.state.zones['mid-river']!.wards[0]!

      expect(camtapWard.type).toBe('camtap')
      expect(snifferWard.type).toBe('sniffer')
      expect(snifferWard.expiryTick).toBeLessThan(camtapWard.expiryTick)
    })

    it('should apply stun buff when Skull Basher bash procs', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-river',
            team: 'chaff',
            items: ['skull_basher', null, null, null, null, null],
          }),
          p2: makePlayer({ id: 'p2', zone: 'mid-river', team: 'audit', name: 'Enemy', hp: 500 }),
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
            zone: 'mid-t1-chaff',
            buffs: [
              { id: 'tp_channeling', stacks: 1, ticksRemaining: 2, source: 'town_portal_scroll' },
              {
                id: 'tp_destination',
                stacks: 1,
                ticksRemaining: 3,
                source: 'town_portal_scroll',
                destination: 'chaff-fountain',
              },
            ],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'move', zone: 'mid-t2-chaff' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      expect(result.state.players['p1']!.zone).toBe('mid-t2-chaff')
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
            team: 'chaff',
            buffs: [
              { id: 'tp_channeling', stacks: 1, ticksRemaining: 2, source: 'town_portal_scroll' },
              {
                id: 'tp_destination',
                stacks: 1,
                ticksRemaining: 3,
                source: 'town_portal_scroll',
                destination: 'chaff-fountain',
              },
            ],
          }),
          p2: makePlayer({
            id: 'p2',
            zone: 'mid-river',
            team: 'audit',
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
            zone: 'mid-t1-chaff',
            buffs: [{ id: 'some_other_buff', stacks: 1, ticksRemaining: 2, source: 'test' }],
          }),
        },
      })

      const actions: PlayerAction[] = [
        { playerId: 'p1', command: { type: 'move', zone: 'mid-t2-chaff' } },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      expect(result.state.players['p1']!.zone).toBe('mid-t2-chaff')
      expect(result.state.players['p1']!.buffs).toHaveLength(1)

      const tpCancelEvents = result.events.filter((e) => e._tag === 'teleport_cancelled')
      expect(tpCancelEvents.length).toBe(0)
    })
  })

  describe('harden', () => {
    it('should make all friendly ice invulnerable when harden is used', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff' }),
        },
      })

      const actions: PlayerAction[] = [{ playerId: 'p1', command: { type: 'harden' } }]

      const result = Effect.runSync(resolveActions(state, actions))

      const chaffIce = result.state.ice.filter((t) => t.team === 'chaff')
      const auditIce = result.state.ice.filter((t) => t.team === 'audit')

      for (const ice of chaffIce) {
        expect(ice.invulnerable).toBe(true)
      }
      for (const ice of auditIce) {
        expect(ice.invulnerable).toBe(false)
      }

      expect(result.state.teams.chaff.hardenUsedTick).toBe(state.tick)
      expect(result.state.teams.audit.hardenUsedTick).toBeNull()

      const glyphEvents = result.events.filter((e) => e._tag === 'harden_used')
      expect(glyphEvents.length).toBe(1)
      expect(glyphEvents[0]!.team).toBe('chaff')
    })

    it('should block attack on invulnerable ice', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            zone: 'mid-t1-audit',
            team: 'chaff',
          }),
        },
        ice: initializeIce().map((t) =>
          t.zone === 'mid-t1-audit' ? { ...t, invulnerable: true } : t,
        ),
      })

      const actions: PlayerAction[] = [
        {
          playerId: 'p1',
          command: { type: 'attack', target: { kind: 'ice', zone: 'mid-t1-audit' } },
        },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      const ice = result.state.ice.find((t) => t.zone === 'mid-t1-audit')
      expect(ice?.hp).toBe(ice?.maxHp)

      const invulnEvents = result.events.filter((e) => e._tag === 'ice_invulnerable')
      expect(invulnEvents.length).toBe(1)
      expect(invulnEvents[0]!.zone).toBe('mid-t1-audit')
    })

    it('damages a vulnerable enemy ice on a basic attack and tracks ice damage', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', zone: 'mid-t1-audit', team: 'chaff' }) },
      })
      const actions: PlayerAction[] = [
        {
          playerId: 'p1',
          command: { type: 'attack', target: { kind: 'ice', zone: 'mid-t1-audit' } },
        },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      const ice = result.state.ice.find((t) => t.zone === 'mid-t1-audit')!
      expect(ice.hp).toBeLessThan(ice.maxHp)
      expect(result.state.players['p1']!.iceDamageDealt).toBeGreaterThan(0)
    })

    it('destroys a low-HP enemy ice and awards the ice-kill bounty', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', zone: 'mid-t1-audit', team: 'chaff', gold: 600 }) },
        ice: initializeIce().map((t) => (t.zone === 'mid-t1-audit' ? { ...t, hp: 1 } : t)),
      })
      const actions: PlayerAction[] = [
        {
          playerId: 'p1',
          command: { type: 'attack', target: { kind: 'ice', zone: 'mid-t1-audit' } },
        },
      ]

      const result = Effect.runSync(resolveActions(state, actions))

      const ice = result.state.ice.find((t) => t.zone === 'mid-t1-audit')!
      expect(ice.alive).toBe(false)
      // awardIceKill pays the in-zone attacker (ice_kill event itself is emitted by GameLoop)
      expect(result.state.players['p1']!.gold).toBeGreaterThan(600)

      // …and says so. The payout was silent, so razing a ice read as a pure
      // objective with no reward.
      const gold = result.events.filter((e) => e._tag === 'gold_change')
      expect(gold).toHaveLength(1)
      expect(gold[0]).toMatchObject({
        playerId: 'p1',
        reason: 'ice kill',
        amount: result.state.players['p1']!.gold - 600,
      })
    })

    it('should reject harden when on cooldown', () => {
      const state = makeGameState({
        tick: 100,
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff' }),
        },
        teams: {
          chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: 50 },
          audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
        },
      })

      const actions: PlayerAction[] = [{ playerId: 'p1', command: { type: 'harden' } }]

      const result = Effect.runSync(resolveActions(state, actions))

      const chaffIce = result.state.ice.filter((t) => t.team === 'chaff')
      for (const ice of chaffIce) {
        expect(ice.invulnerable).toBe(false)
      }

      const cooldownEvents = result.events.filter((e) => e._tag === 'harden_on_cooldown')
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
      // Item actives resolve in Phase 0 now (ahead of the ability they set up),
      // so the passives phase later in the SAME tick already sees the regen
      // buff — drinking a salve heals on the tick you drink it. It used to
      // resolve after passives, in the shop phase, and do nothing until tick 2.
      expect(p1.hp).toBe(350)

      const tick2 = Effect.runSync(resolveActions(tick1.state, []))
      expect(tick2.state.players['p1']!.hp).toBe(400)
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
      expect(dest?.destination).toBe('chaff-fountain')

      // GameLoop ticks buffs each tick; teleport completes when channel finishes
      let channeled = result.state
      for (let i = 0; i < 3; i++) {
        channeled = tickAllBuffs(channeled)
      }
      expect(channeled.players['p1']!.zone).toBe('chaff-fountain')
    })

    it('blink module moves the player to an adjacent zone', () => {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            zone: 'mid-t1-chaff',
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
          p1: makePlayer({ id: 'p1', zone: 'mid-river', team: 'chaff' }),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            zone: 'mid-river',
            team: 'audit',
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
            team: 'chaff',
            hp: 550,
            maxHp: 550,
          }),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            zone: 'mid-river',
            team: 'audit',
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
            zone: 'mid-t1-chaff',
            items: ['blink_module', null, null, null, null, null],
          }),
        },
      })

      // audit-fountain is not adjacent to mid-t1-chaff — useItem fails
      const result = Effect.runSync(
        resolveActions(state, [
          {
            playerId: 'p1',
            command: { type: 'use', item: 'blink_module', target: 'audit-fountain' },
          },
        ]),
      )
      const p1 = result.state.players['p1']!
      expect(p1.zone).toBe('mid-t1-chaff')
      expect(p1.items[0]).toBe('blink_module')
      expect(result.events.filter((e) => e._tag === 'ability_used')).toHaveLength(0)
    })
  })

  describe('ancient attacks', () => {
    function stateWithVulnerableAuditAncient(playerZone: string, vulnerable = true): GameState {
      const ancients = initializeAncients()
      return makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: playerZone }) },
        ancients: { ...ancients, audit: { ...ancients.audit, vulnerable } },
      })
    }

    it('damages the vulnerable enemy ancient from the enemy base', () => {
      const state = stateWithVulnerableAuditAncient('audit-base')
      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'ancient' } } },
        ]),
      )

      expect(result.state.ancients.audit.hp).toBeLessThan(state.ancients.audit.hp)
      const dmg = result.events.find(
        (e) => e._tag === 'damage' && e.targetId === 'ancient_audit' && e.sourceId === 'p1',
      )
      expect(dmg).toBeDefined()
      // Counts as structure damage on the scoreboard
      expect(result.state.players['p1']!.iceDamageDealt).toBeGreaterThan(0)
    })

    it('does not damage an invulnerable ancient', () => {
      const state = stateWithVulnerableAuditAncient('audit-base', false)
      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'ancient' } } },
        ]),
      )

      expect(result.state.ancients.audit.hp).toBe(state.ancients.audit.hp)
      expect(result.events.filter((e) => e._tag === 'damage')).toHaveLength(0)
    })

    it('requires the attacker to be in the enemy base zone', () => {
      const state = stateWithVulnerableAuditAncient('mid-river')
      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'ancient' } } },
        ]),
      )

      expect(result.state.ancients.audit.hp).toBe(state.ancients.audit.hp)
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
      makePlayer({ id: 'p2', name: 'Enemy', team: 'audit', zone: 'mid-river', ...echoStats, buffs })
    const caster = () => makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river', ...echoStats })

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

    it('Lotus Orb negates the spell on the holder and bounces its damage to the caster', () => {
      const state = makeGameState({
        players: {
          p1: caster(),
          p2: enemy([{ id: 'lotus_orb', stacks: 1, ticksRemaining: 5, source: 'lotus_orb' }]),
        },
      })
      const result = castQ(state)
      expect(result.state.players['p2']!.hp).toBe(550) // holder unharmed (negated)
      expect(result.state.players['p2']!.buffs.some((b) => b.id === 'lotus_orb')).toBe(false) // spent
      expect(result.state.players['p1']!.hp).toBeLessThan(550) // caster took the reflected damage
      const ev = result.events.find((e) => e._tag === 'spell_blocked')
      expect(ev && ev._tag === 'spell_blocked' ? ev.source : null).toBe('lotus_orb')
    })
  })

  describe('Stack Overflow (Overclock 2x)', () => {
    const echoStats = { heroId: 'echo', hp: 550, maxHp: 550, mp: 280, maxMp: 280 } as const
    const castQ = (state: GameState) =>
      Effect.runSync(
        resolveActions(state, [
          {
            playerId: 'p1',
            command: { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'p2' } },
          },
        ]),
      )
    const build = (casterBuffs: PlayerState['buffs']) =>
      makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'chaff',
            zone: 'mid-river',
            ...echoStats,
            buffs: casterBuffs,
          }),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            team: 'audit',
            zone: 'mid-river',
            ...echoStats,
          }),
        },
      })

    it('doubles the next ability damage and consumes the charge', () => {
      const baseDmg = 550 - castQ(build([])).state.players['p2']!.hp
      expect(baseDmg).toBeGreaterThan(0)

      const r = castQ(
        build([
          { id: 'stack_overflow_buff', stacks: 1, ticksRemaining: 10, source: 'stack_overflow' },
        ]),
      )
      const ocDmg = 550 - r.state.players['p2']!.hp
      expect(ocDmg).toBe(baseDmg * 2)
      // charge spent
      expect(r.state.players['p1']!.buffs.some((b) => b.id === 'stack_overflow_buff')).toBe(false)
    })
  })

  describe('crit stacking', () => {
    // Two heroes in the same zone; the attacker basic-attacks the defender.
    // We stub Math.random to deterministic values so crit procs are controlled.
    function attackState(attackerItems: (string | null)[]): {
      state: GameState
      attack: () => { rolledCrit: boolean; damage: number }
    } {
      // Use the hero's REAL stats so the per-tick maxHp recalculation doesn't
      // collapse an inflated HP pool mid-tick and mask the actual attack damage.
      const echo = HEROES.echo!
      const maxHp = echo.baseStats.hp
      const maxMp = echo.baseStats.mp
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'chaff',
            zone: 'mid-river',
            items: attackerItems,
            hp: maxHp,
            maxHp,
            mp: maxMp,
            maxMp,
          }),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            team: 'audit',
            zone: 'mid-river',
            hp: maxHp,
            maxHp,
            mp: maxMp,
            maxMp,
          }),
        },
      })
      return {
        state,
        attack: () => {
          const before = maxHp
          const result = Effect.runSync(
            resolveActions(state, [
              { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'p2' } } },
            ]),
          )
          const after = result.state.players['p2']!.hp
          const damage = before - after
          // echo base attack ~58 + crit item bonuses (+120) = ~178 effective.
          // Non-crit damage vs defense 3 = ~173. Crits multiply by 1.5/1.75/
          // 2.4, so the weakest crit (1.5x) yields ~260. Threshold 220 separates
          // non-crit from any crit cleanly.
          const rolledCrit = damage > 220
          return { rolledCrit, damage }
        },
      }
    }

    it('rolls the single highest-chance crit source when multiple are owned', () => {
      // Owns null_pointer (15%), crystalys (20%), daedalus (30%).
      // Highest chance = daedalus 30%. Return 0.29 < 0.30 → daedalus procs.
      const { attack } = attackState(['null_pointer', 'crystalys', 'daedalus', null, null, null])
      const original = Math.random
      Math.random = () => 0.29
      try {
        const { rolledCrit, damage } = attack()
        expect(rolledCrit).toBe(true)
        // daedalus multiplier is 2.4x — non-crit is ~173, crit ~415.
        expect(damage).toBeGreaterThan(300)
      } finally {
        Math.random = original
      }
    })

    it('does not proc a crit when the roll exceeds the highest chance', () => {
      const { attack } = attackState(['null_pointer', 'crystalys', 'daedalus', null, null, null])
      const original = Math.random
      // All calls return 0.31 (> 0.30 daedalus → no crit, > 0.25 maelstrom/basher
      // → no proc, > 0.6 vanguard → no block). The crit roll is the first random
      // call in the attack path (no slow/stealth random before it).
      Math.random = () => 0.31
      try {
        const { rolledCrit } = attack()
        expect(rolledCrit).toBe(false)
      } finally {
        Math.random = original
      }
    })

    it('owning multiple crit items is never worse than owning the best one alone', () => {
      // The old else-if chain meant owning null_pointer (15%) + daedalus (30%)
      // could MISS on null_pointer's 15% and then skip daedalus entirely. The
      // new highest-chance-wins logic rolls daedalus independently of the lower
      // sources. Verify: at roll 0.16 (a hit on daedalus 30%), both the stacked
      // build and the bare-daedalus build proc a crit.
      const stacked = attackState(['null_pointer', 'daedalus', null, null, null, null])
      const bare = attackState(['daedalus', null, null, null, null, null])
      const original = Math.random
      Math.random = () => 0.16
      try {
        expect(stacked.attack().rolledCrit).toBe(true)
        expect(bare.attack().rolledCrit).toBe(true)
      } finally {
        Math.random = original
      }
    })
  })

  describe('skull_basher bash narration', () => {
    // The bash is applied deep inside the attack phase's staged buff list, so
    // it can't be recovered by the buff diff the cast/item paths use — it is
    // announced at the point of application instead. Without this the target
    // simply lost their next action with no explanation anywhere.
    function bashState() {
      return makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'chaff',
            zone: 'mid-river',
            items: ['skull_basher', null, null, null, null, null],
          }),
          p2: makePlayer({ id: 'p2', name: 'Enemy', team: 'audit', zone: 'mid-river' }),
        },
      })
    }
    const attack: PlayerAction[] = [
      { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'p2' } } },
    ]

    it('emits status_applied when the bash procs', () => {
      const original = Math.random
      Math.random = () => 0 // every proc roll hits, including the 25% bash
      try {
        const result = Effect.runSync(resolveActions(bashState(), attack))
        expect(result.state.players['p2']!.buffs.some((b) => b.id === 'stun')).toBe(true)
        expect(result.events.filter((e) => e._tag === 'status_applied')).toEqual([
          {
            _tag: 'status_applied',
            tick: 1,
            sourceId: 'p1',
            targetId: 'p2',
            status: 'stun',
            ticksRemaining: 2,
          },
        ])
      } finally {
        Math.random = original
      }
    })

    it('emits nothing when the bash does not proc', () => {
      const original = Math.random
      Math.random = () => 0.99
      try {
        const result = Effect.runSync(resolveActions(bashState(), attack))
        expect(result.events.some((e) => e._tag === 'status_applied')).toBe(false)
      } finally {
        Math.random = original
      }
    })
  })

  describe('hasDebuff exact-match gating', () => {
    it('a buff id containing a debuff substring but not equal to it does NOT gate actions', () => {
      // A hypothetical 'stun_immune' buff would have falsely gated attacks
      // under the old substring match. The exact-match DEBUFF_ID_SETS only
      // gates on the real 'stun' id.
      const immuneButNotStunned = makePlayer({
        id: 'p1',
        team: 'chaff',
        zone: 'mid-river',
        buffs: [{ id: 'stun_immune', stacks: 1, ticksRemaining: 2, source: 'x' }],
      })
      const enemy = makePlayer({
        id: 'p2',
        name: 'Enemy',
        team: 'audit',
        zone: 'mid-river',
        hp: 9999,
        maxHp: 9999,
      })
      const state = makeGameState({ players: { p1: immuneButNotStunned, p2: enemy } })
      const result = Effect.runSync(
        resolveActions(state, [
          { playerId: 'p1', command: { type: 'attack', target: { kind: 'hero', name: 'p2' } } },
        ]),
      )
      // The attack resolved (not rejected) — stun_immune did not gate it.
      expect(result.rejected).toHaveLength(0)
      // Damage landed (hp dropped below 9999).
      expect(result.state.players['p2']!.hp).toBeLessThan(9999)
    })
  })

  /**
   * A player gets ONE action per 4-second tick. Every attack that resolves to
   * nothing used to `continue` in silence — no damage, no message, and `canAct`
   * false for the next four seconds. These pin the feedback for each mis-target
   * class; `rejected` is also the channel GameLoop uses to keep a whiffed swing
   * out of `succeededActions` (no phantom on-attack passive) and out of the
   * tutorial's "the player performed the taught verb" check.
   */
  describe('attack mis-targets are reported, never swallowed', () => {
    const attacker = () => makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })

    const attack = (state: GameState, target: TargetRef) =>
      Effect.runSync(
        resolveActions(state, [{ playerId: 'p1', command: { type: 'attack', target } }]),
      )

    it('names an unknown hero instead of eating the tick', () => {
      const state = makeGameState({ players: { p1: attacker() } })
      const result = attack(state, { kind: 'hero', name: 'nosuchhero' })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]).toMatchObject({ playerId: 'p1' })
      expect(result.rejected[0]!.reason).toContain('nosuchhero')
    })

    it('says the hero target died before the attack landed', () => {
      const state = makeGameState({
        players: {
          p1: attacker(),
          p2: makePlayer({
            id: 'p2',
            name: 'Enemy',
            team: 'audit',
            zone: 'mid-river',
            alive: false,
          }),
        },
      })
      const result = attack(state, { kind: 'hero', name: 'p2' })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toMatch(/died/i)
    })

    it('says the hero target is an ally (and deals them no damage)', () => {
      const state = makeGameState({
        players: {
          p1: attacker(),
          p2: makePlayer({ id: 'p2', name: 'Buddy', team: 'chaff', zone: 'mid-river', hp: 500 }),
        },
      })
      const result = attack(state, { kind: 'hero', name: 'p2' })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toContain('Buddy')
      expect(result.rejected[0]!.reason).toMatch(/your team/i)
      // Assert on the damage channel, not raw hp — the stat recalc rescales hp
      // when maxHp is recomputed, so a raw hp comparison is confounded.
      expect(result.events.some((e) => e._tag === 'damage' && e.targetId === 'p2')).toBe(false)
    })

    it('says there are no waves here when the zone is empty', () => {
      const state = makeGameState({ players: { p1: attacker() } })
      const result = attack(state, { kind: 'wave', index: 0 })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toMatch(/no waves/i)
    })

    it('quotes the usable wave index range when the index is out of bounds', () => {
      const state = makeGameState({
        players: { p1: attacker() },
        waves: [
          { id: 'c0', team: 'audit', zone: 'mid-river', hp: 400, type: 'line' },
          { id: 'c1', team: 'audit', zone: 'mid-river', hp: 400, type: 'line' },
          // A wave in another zone must not widen the quoted range.
          { id: 'c2', team: 'audit', zone: 'top-river', hp: 400, type: 'line' },
        ],
      })
      const result = attack(state, { kind: 'wave', index: 4 })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toContain('wave:0-1')
    })

    it('says the wave is already dead', () => {
      const state = makeGameState({
        players: { p1: attacker() },
        waves: [{ id: 'c0', team: 'audit', zone: 'mid-river', hp: 0, type: 'line' }],
      })
      const result = attack(state, { kind: 'wave', index: 0 })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toMatch(/already dead/i)
    })

    it('refuses an own-team wave and pays no last-hit gold', () => {
      // The bug this pins: with no team guard the swing killed the ally wave
      // and banked the FULL last-hit bounty — the opposite of last-hitting.
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river', gold: 600 }) },
        waves: [{ id: 'ally0', team: 'chaff', zone: 'mid-river', hp: 5, type: 'line' }],
      })
      const result = attack(state, { kind: 'wave', index: 0 })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toMatch(/own wave/i)
      expect(result.state.waves[0]!.hp).toBe(5)
      expect(result.state.players['p1']!.gold).toBe(600)
      expect(result.state.players['p1']!.xp).toBe(0)
    })

    it('says there is no standing ice in the targeted zone', () => {
      const state = makeGameState({ players: { p1: attacker() } })
      const result = attack(state, { kind: 'ice', zone: 'mid-river' })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toContain('mid-river')
    })

    it('says Tenant is already dead', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'hollow' }) },
        tenant: { alive: false, hp: 0, maxHp: 2000, deathTick: 1 },
      })
      const result = attack(state, { kind: 'tenant' })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toMatch(/tenant/i)
    })

    it('reports a dead neutral and an out-of-range neutral index differently', () => {
      const state = makeGameState({
        players: { p1: makePlayer({ id: 'p1', team: 'chaff', zone: 'silt-chaff-top' }) },
        neutrals: [
          {
            id: 'n0',
            zone: 'silt-chaff-top',
            hp: 0,
            maxHp: 100,
            type: 'stub',
            alive: false,
          },
        ],
      })
      expect(attack(state, { kind: 'neutral', index: 0 }).rejected[0]!.reason).toMatch(
        /already dead/i,
      )
      expect(attack(state, { kind: 'neutral', index: 7 }).rejected[0]!.reason).toMatch(/index/i)
    })

    it('rejects a target kind the attack phase has no branch for', () => {
      // The wire schema accepts every TargetRef kind for `attack`, including
      // 'zone' and 'self', which fell off the end of the branch chain.
      const state = makeGameState({ players: { p1: attacker() } })
      const result = attack(state, { kind: 'zone', zone: 'mid-river' })
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.reason).toMatch(/cannot attack/i)
    })
  })
})
