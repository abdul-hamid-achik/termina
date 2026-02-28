import { describe, it, expect } from 'vitest'
import { Either } from 'effect'
import type {
  ClientMessage,
  TickStateMessage,
  EventsMessage,
  AnnouncementMessage,
  ErrorMessage,
  HeroPickMessage,
  LobbyStateMessage,
  GameStartingMessage,
  GameCountdownMessage,
  GameOverMessage,
} from '../../../shared/types/protocol'
import {
  parseCommand,
  parseCommandEither,
} from '../../../server/game/protocol/commands'
import {
  parseClientMessage,
  parseClientMessageEither,
} from '../../../server/game/protocol/messages'
import {
  toGameEvent,
  type DamageEvent,
  type KillEvent,
  type HealEvent,
  type DeathEvent,
  type TowerKillEvent,
  type CreepLasthitEvent,
  type GoldChangeEvent,
  type LevelUpEvent,
  type AbilityUsedEvent,
  type ItemPurchasedEvent,
  type WardPlacedEvent,
} from '../../../server/game/protocol/events'

// ── Tests ──────────────────────────────────────────────────────────

describe('Protocol Message Types', () => {
  describe('ClientMessage parsing', () => {
    it('parses heartbeat message', () => {
      const raw = '{"type":"heartbeat"}'
      const msg: ClientMessage = JSON.parse(raw)
      expect(msg.type).toBe('heartbeat')
    })

    it('parses action message', () => {
      const raw = '{"type":"action","command":{"type":"move","target":"mid-river"}}'
      const msg: ClientMessage = JSON.parse(raw)
      expect(msg.type).toBe('action')
      if (msg.type === 'action') {
        expect(msg.command).toBeDefined()
      }
    })

    it('parses join_game message', () => {
      const raw = '{"type":"join_game","gameId":"game_123"}'
      const msg: ClientMessage = JSON.parse(raw)
      expect(msg.type).toBe('join_game')
      if (msg.type === 'join_game') {
        expect(msg.gameId).toBe('game_123')
      }
    })

    it('parses reconnect message', () => {
      const raw = '{"type":"reconnect","gameId":"game_123","playerId":"p1"}'
      const msg: ClientMessage = JSON.parse(raw)
      expect(msg.type).toBe('reconnect')
      if (msg.type === 'reconnect') {
        expect(msg.gameId).toBe('game_123')
        expect(msg.playerId).toBe('p1')
      }
    })

    it('parses hero_pick message', () => {
      const raw = '{"type":"hero_pick","lobbyId":"lobby_123","heroId":"echo"}'
      const msg: ClientMessage = JSON.parse(raw)
      expect(msg.type).toBe('hero_pick')
      if (msg.type === 'hero_pick') {
        expect(msg.lobbyId).toBe('lobby_123')
        expect(msg.heroId).toBe('echo')
      }
    })

    it('parses chat message', () => {
      const raw = '{"type":"chat","channel":"team","message":"hello"}'
      const msg: ClientMessage = JSON.parse(raw)
      expect(msg.type).toBe('chat')
      if (msg.type === 'chat') {
        expect(msg.channel).toBe('team')
        expect(msg.message).toBe('hello')
      }
    })

    it('parses ping_map message', () => {
      const raw = '{"type":"ping_map","zone":"mid-river"}'
      const msg: ClientMessage = JSON.parse(raw)
      expect(msg.type).toBe('ping_map')
      if (msg.type === 'ping_map') {
        expect(msg.zone).toBe('mid-river')
      }
    })
  })

  describe('ServerMessage structures', () => {
    it('tick_state has required fields', () => {
      const msg: TickStateMessage = {
        type: 'tick_state',
        tick: 42,
        state: {} as TickStateMessage['state'],
      }
      expect(msg.type).toBe('tick_state')
      expect(msg.tick).toBe(42)
    })

    it('events message has events array', () => {
      const msg: EventsMessage = {
        type: 'events',
        tick: 10,
        events: [{ tick: 10, text: 'Player attacked', type: 'combat' }],
      }
      expect(msg.events).toHaveLength(1)
      expect(msg.events[0]!.type).toBe('combat')
    })

    it('announcement has message and level', () => {
      const msg: AnnouncementMessage = {
        type: 'announcement',
        message: 'Connected',
        level: 'info',
      }
      expect(msg.level).toBe('info')
    })

    it('error has code and message', () => {
      const msg: ErrorMessage = {
        type: 'error',
        code: 'AUTH_REQUIRED',
        message: 'Missing playerId',
      }
      expect(msg.code).toBe('AUTH_REQUIRED')
    })

    it('hero_pick has playerId and heroId', () => {
      const msg: HeroPickMessage = {
        type: 'hero_pick',
        playerId: 'p1',
        heroId: 'echo',
      }
      expect(msg.playerId).toBe('p1')
      expect(msg.heroId).toBe('echo')
    })

    it('lobby_state has team and players', () => {
      const msg: LobbyStateMessage = {
        type: 'lobby_state',
        lobbyId: 'lobby_1',
        team: 'radiant',
        players: [
          { playerId: 'p1', team: 'radiant', heroId: null },
          { playerId: 'p2', team: 'dire', heroId: null },
        ],
      }
      expect(msg.players).toHaveLength(2)
      expect(msg.team).toBe('radiant')
    })

    it('game_starting has gameId', () => {
      const msg: GameStartingMessage = {
        type: 'game_starting',
        gameId: 'game_abc',
      }
      expect(msg.gameId).toBe('game_abc')
    })

    it('game_countdown has seconds', () => {
      const msg: GameCountdownMessage = {
        type: 'game_countdown',
        seconds: 10,
      }
      expect(msg.seconds).toBe(10)
    })

    it('game_over has winner and stats', () => {
      const msg: GameOverMessage = {
        type: 'game_over',
        winner: 'radiant',
        stats: {
          p1: {
            kills: 5,
            deaths: 2,
            assists: 10,
            gold: 5000,
            items: ['item1', null, null, null, null, null],
            heroDamage: 12000,
            towerDamage: 3000,
          },
        },
      }
      expect(msg.winner).toBe('radiant')
      expect(msg.stats['p1']!.kills).toBe(5)
    })
  })

  describe('JSON serialization round-trip', () => {
    it('tick_state survives JSON round-trip', () => {
      const original: TickStateMessage = {
        type: 'tick_state',
        tick: 100,
        state: {
          tick: 100,
          phase: 'playing',
          teams: {
            radiant: { id: 'radiant', kills: 3, towerKills: 1, gold: 5000 },
            dire: { id: 'dire', kills: 2, towerKills: 0, gold: 4500 },
          },
          players: {},
          zones: {},
          creeps: [],
          towers: [],
          events: [],
        } as unknown as TickStateMessage['state'],
      }
      const parsed = JSON.parse(JSON.stringify(original))
      expect(parsed.type).toBe('tick_state')
      expect(parsed.tick).toBe(100)
      expect(parsed.state.phase).toBe('playing')
    })

    it('error message survives JSON round-trip', () => {
      const original: ErrorMessage = {
        type: 'error',
        code: 'INVALID_JSON',
        message: 'Invalid JSON message',
      }
      const parsed: ErrorMessage = JSON.parse(JSON.stringify(original))
      expect(parsed).toEqual(original)
    })
  })
})

// ── Schema-based Command Parsing ──────────────────────────────────

describe('Command Schema Parsing', () => {
  describe('parseCommand', () => {
    it('parses a move command', () => {
      const cmd = parseCommand({ type: 'move', zone: 'mid-river' })
      expect(cmd.type).toBe('move')
    })

    it('parses an attack command with hero target', () => {
      const cmd = parseCommand({
        type: 'attack',
        target: { kind: 'hero', name: 'echo' },
      })
      expect(cmd.type).toBe('attack')
    })

    it('parses an attack command with creep target', () => {
      const cmd = parseCommand({
        type: 'attack',
        target: { kind: 'creep', index: 2 },
      })
      expect(cmd.type).toBe('attack')
    })

    it('parses an attack command with tower target', () => {
      const cmd = parseCommand({
        type: 'attack',
        target: { kind: 'tower', zone: 'mid-t1-rad' },
      })
      expect(cmd.type).toBe('attack')
    })

    it('parses a cast command with ability key', () => {
      const cmd = parseCommand({ type: 'cast', ability: 'q' })
      expect(cmd.type).toBe('cast')
    })

    it('parses a cast command with target', () => {
      const cmd = parseCommand({
        type: 'cast',
        ability: 'r',
        target: { kind: 'hero', name: 'daemon' },
      })
      expect(cmd.type).toBe('cast')
    })

    it('parses a buy command', () => {
      const cmd = parseCommand({ type: 'buy', item: 'iron_branch' })
      expect(cmd.type).toBe('buy')
    })

    it('parses a sell command', () => {
      const cmd = parseCommand({ type: 'sell', item: 'iron_branch' })
      expect(cmd.type).toBe('sell')
    })

    it('parses a ward command', () => {
      const cmd = parseCommand({ type: 'ward', zone: 'mid-river' })
      expect(cmd.type).toBe('ward')
    })

    it('parses a scan command', () => {
      const cmd = parseCommand({ type: 'scan' })
      expect(cmd.type).toBe('scan')
    })

    it('parses a status command', () => {
      const cmd = parseCommand({ type: 'status' })
      expect(cmd.type).toBe('status')
    })

    it('parses a map command', () => {
      const cmd = parseCommand({ type: 'map' })
      expect(cmd.type).toBe('map')
    })

    it('parses a chat command', () => {
      const cmd = parseCommand({ type: 'chat', channel: 'team', message: 'hello' })
      expect(cmd.type).toBe('chat')
    })

    it('parses a ping command', () => {
      const cmd = parseCommand({ type: 'ping', zone: 'top-river' })
      expect(cmd.type).toBe('ping')
    })

    it('throws on invalid command type', () => {
      expect(() => parseCommand({ type: 'invalid_command' })).toThrow()
    })

    it('throws on missing required fields', () => {
      expect(() => parseCommand({ type: 'move' })).toThrow() // missing zone
    })

    it('throws on invalid ability key', () => {
      expect(() => parseCommand({ type: 'cast', ability: 'z' })).toThrow()
    })
  })

  describe('parseCommandEither', () => {
    it('returns Right for valid command', () => {
      const result = parseCommandEither({ type: 'move', zone: 'mid-river' })
      expect(Either.isRight(result)).toBe(true)
    })

    it('returns Left for invalid command', () => {
      const result = parseCommandEither({ type: 'bad_cmd' })
      expect(Either.isLeft(result)).toBe(true)
    })
  })
})

// ── Schema-based Client Message Parsing ───────────────────────────

describe('ClientMessage Schema Parsing', () => {
  describe('parseClientMessage', () => {
    it('parses action message with move command', () => {
      const msg = parseClientMessage({
        type: 'action',
        command: { type: 'move', zone: 'mid-river' },
      })
      expect(msg.type).toBe('action')
    })

    it('parses chat message', () => {
      const msg = parseClientMessage({
        type: 'chat',
        channel: 'all',
        message: 'gg',
      })
      expect(msg.type).toBe('chat')
    })

    it('parses ping_map message', () => {
      const msg = parseClientMessage({ type: 'ping_map', zone: 'rune-top' })
      expect(msg.type).toBe('ping_map')
    })

    it('parses heartbeat message', () => {
      const msg = parseClientMessage({ type: 'heartbeat' })
      expect(msg.type).toBe('heartbeat')
    })

    it('parses reconnect message', () => {
      const msg = parseClientMessage({
        type: 'reconnect',
        gameId: 'game_1',
        playerId: 'p1',
      })
      expect(msg.type).toBe('reconnect')
    })

    it('throws on invalid message type', () => {
      expect(() => parseClientMessage({ type: 'unknown' })).toThrow()
    })

    it('throws on missing required fields', () => {
      expect(() => parseClientMessage({ type: 'chat' })).toThrow() // missing channel and message
    })
  })

  describe('parseClientMessageEither', () => {
    it('returns Right for valid message', () => {
      const result = parseClientMessageEither({ type: 'heartbeat' })
      expect(Either.isRight(result)).toBe(true)
    })

    it('returns Left for invalid message', () => {
      const result = parseClientMessageEither({ type: 'invalid' })
      expect(Either.isLeft(result)).toBe(true)
    })
  })
})

// ── Game Event Conversion ─────────────────────────────────────────

describe('Game Engine Events', () => {
  describe('toGameEvent', () => {
    it('converts DamageEvent to wire format', () => {
      const event: DamageEvent = {
        _tag: 'damage',
        tick: 5,
        sourceId: 'p1',
        targetId: 'p2',
        amount: 100,
        damageType: 'physical',
      }
      const wire = toGameEvent(event)
      expect(wire.tick).toBe(5)
      expect(wire.type).toBe('damage')
      expect(wire.payload.sourceId).toBe('p1')
      expect(wire.payload.targetId).toBe('p2')
      expect(wire.payload.amount).toBe(100)
      expect(wire.payload.damageType).toBe('physical')
    })

    it('converts KillEvent to wire format', () => {
      const event: KillEvent = {
        _tag: 'kill',
        tick: 10,
        killerId: 'p1',
        victimId: 'p2',
        assisters: ['p3', 'p4'],
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('kill')
      expect(wire.payload.killerId).toBe('p1')
      expect(wire.payload.assisters).toEqual(['p3', 'p4'])
    })

    it('converts HealEvent to wire format', () => {
      const event: HealEvent = {
        _tag: 'heal',
        tick: 15,
        sourceId: 'p1',
        targetId: 'p1',
        amount: 50,
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('heal')
      expect(wire.payload.amount).toBe(50)
    })

    it('converts DeathEvent to wire format', () => {
      const event: DeathEvent = {
        _tag: 'death',
        tick: 20,
        playerId: 'p2',
        respawnTick: 30,
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('death')
      expect(wire.payload.playerId).toBe('p2')
      expect(wire.payload.respawnTick).toBe(30)
    })

    it('converts TowerKillEvent to wire format', () => {
      const event: TowerKillEvent = {
        _tag: 'tower_kill',
        tick: 25,
        zone: 'mid-t1-rad',
        team: 'radiant',
        killerTeam: 'dire',
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('tower_kill')
      expect(wire.payload.zone).toBe('mid-t1-rad')
    })

    it('converts CreepLasthitEvent to wire format', () => {
      const event: CreepLasthitEvent = {
        _tag: 'creep_lasthit',
        tick: 30,
        playerId: 'p1',
        creepId: 'c1',
        creepType: 'melee',
        goldAwarded: 40,
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('creep_lasthit')
      expect(wire.payload.goldAwarded).toBe(40)
    })

    it('converts GoldChangeEvent to wire format', () => {
      const event: GoldChangeEvent = {
        _tag: 'gold_change',
        tick: 35,
        playerId: 'p1',
        amount: 200,
        reason: 'kill_bounty',
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('gold_change')
      expect(wire.payload.reason).toBe('kill_bounty')
    })

    it('converts LevelUpEvent to wire format', () => {
      const event: LevelUpEvent = {
        _tag: 'level_up',
        tick: 40,
        playerId: 'p1',
        newLevel: 6,
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('level_up')
      expect(wire.payload.newLevel).toBe(6)
    })

    it('converts AbilityUsedEvent to wire format', () => {
      const event: AbilityUsedEvent = {
        _tag: 'ability_used',
        tick: 45,
        playerId: 'p1',
        abilityId: 'echo_q',
        targetId: 'p2',
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('ability_used')
      expect(wire.payload.abilityId).toBe('echo_q')
    })

    it('converts ItemPurchasedEvent to wire format', () => {
      const event: ItemPurchasedEvent = {
        _tag: 'item_purchased',
        tick: 50,
        playerId: 'p1',
        itemId: 'iron_branch',
        cost: 50,
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('item_purchased')
      expect(wire.payload.cost).toBe(50)
    })

    it('converts WardPlacedEvent to wire format', () => {
      const event: WardPlacedEvent = {
        _tag: 'ward_placed',
        tick: 55,
        playerId: 'p1',
        zone: 'mid-river',
        team: 'radiant',
      }
      const wire = toGameEvent(event)
      expect(wire.type).toBe('ward_placed')
      expect(wire.payload.zone).toBe('mid-river')
    })

    it('strips _tag from payload', () => {
      const event: DamageEvent = {
        _tag: 'damage',
        tick: 1,
        sourceId: 'a',
        targetId: 'b',
        amount: 10,
        damageType: 'magical',
      }
      const wire = toGameEvent(event)
      expect(wire.payload).not.toHaveProperty('_tag')
      expect(wire.payload).not.toHaveProperty('tick')
    })
  })
})
