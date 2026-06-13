import { describe, it, expect } from 'vitest'
import { clientMessageSchema, commandSchema } from '~~/server/utils/ws-schemas'

/** Helpers */
const str = (n: number) => 'a'.repeat(n)
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  expect(schema.safeParse(value).success, `expected valid: ${JSON.stringify(value)}`).toBe(true)
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  expect(schema.safeParse(value).success, `expected invalid: ${JSON.stringify(value)}`).toBe(false)

describe('targetRefSchema (via commandSchema attack)', () => {
  const attack = (target: unknown) => ({ type: 'attack', target })

  describe('hero', () => {
    it('accepts a hero target with a name', () => {
      ok(commandSchema, attack({ kind: 'hero', name: 'axe' }))
    })
    it('accepts name at max length 64', () => {
      ok(commandSchema, attack({ kind: 'hero', name: str(64) }))
    })
    it('rejects empty name', () => {
      bad(commandSchema, attack({ kind: 'hero', name: '' }))
    })
    it('rejects name over 64 chars', () => {
      bad(commandSchema, attack({ kind: 'hero', name: str(65) }))
    })
    it('rejects missing name', () => {
      bad(commandSchema, attack({ kind: 'hero' }))
    })
    it('rejects non-string name', () => {
      bad(commandSchema, attack({ kind: 'hero', name: 42 }))
    })
  })

  describe('creep', () => {
    it('accepts index 0 (lower bound)', () => {
      ok(commandSchema, attack({ kind: 'creep', index: 0 }))
    })
    it('accepts index 10000 (upper bound)', () => {
      ok(commandSchema, attack({ kind: 'creep', index: 10_000 }))
    })
    it('rejects index -1', () => {
      bad(commandSchema, attack({ kind: 'creep', index: -1 }))
    })
    it('rejects index 10001', () => {
      bad(commandSchema, attack({ kind: 'creep', index: 10_001 }))
    })
    it('rejects non-integer index', () => {
      bad(commandSchema, attack({ kind: 'creep', index: 1.5 }))
    })
    it('rejects missing index', () => {
      bad(commandSchema, attack({ kind: 'creep' }))
    })
    it('rejects string index', () => {
      bad(commandSchema, attack({ kind: 'creep', index: '3' }))
    })
  })

  describe('neutral', () => {
    it('accepts valid index bounds', () => {
      ok(commandSchema, attack({ kind: 'neutral', index: 0 }))
      ok(commandSchema, attack({ kind: 'neutral', index: 10_000 }))
    })
    it('rejects out-of-bounds index', () => {
      bad(commandSchema, attack({ kind: 'neutral', index: -1 }))
      bad(commandSchema, attack({ kind: 'neutral', index: 10_001 }))
    })
  })

  describe('tower', () => {
    it('accepts a tower target with a zone', () => {
      ok(commandSchema, attack({ kind: 'tower', zone: 'top_t1' }))
    })
    it('accepts zone at max length 64', () => {
      ok(commandSchema, attack({ kind: 'tower', zone: str(64) }))
    })
    it('rejects empty zone', () => {
      bad(commandSchema, attack({ kind: 'tower', zone: '' }))
    })
    it('rejects zone over 64 chars', () => {
      bad(commandSchema, attack({ kind: 'tower', zone: str(65) }))
    })
    it('rejects missing zone', () => {
      bad(commandSchema, attack({ kind: 'tower' }))
    })
  })

  describe('roshan', () => {
    it('accepts a bare roshan target', () => {
      ok(commandSchema, attack({ kind: 'roshan' }))
    })
  })

  describe('ancient', () => {
    it('accepts a bare ancient target (new win-condition variant)', () => {
      ok(commandSchema, attack({ kind: 'ancient' }))
    })
    it('strips extra fields on ancient target', () => {
      const result = commandSchema.safeParse(attack({ kind: 'ancient', sneaky: true }))
      expect(result.success).toBe(true)
      if (result.success && result.data.type === 'attack') {
        expect(result.data.target).toEqual({ kind: 'ancient' })
      }
    })
  })

  describe('zone', () => {
    it('accepts a zone target', () => {
      ok(commandSchema, attack({ kind: 'zone', zone: 'river' }))
    })
    it('rejects missing zone field', () => {
      bad(commandSchema, attack({ kind: 'zone' }))
    })
  })

  describe('self', () => {
    it('accepts a bare self target', () => {
      ok(commandSchema, attack({ kind: 'self' }))
    })
  })

  it('rejects unknown target kind', () => {
    bad(commandSchema, attack({ kind: 'courier' }))
  })

  it('rejects target with missing kind', () => {
    bad(commandSchema, attack({ name: 'axe' }))
  })

  it('rejects non-object targets', () => {
    bad(commandSchema, attack('axe'))
    bad(commandSchema, attack(7))
    bad(commandSchema, attack(null))
    bad(commandSchema, attack(['hero']))
  })
})

describe('commandSchema', () => {
  describe('move', () => {
    it('accepts a valid move', () => {
      ok(commandSchema, { type: 'move', zone: 'mid_lane' })
    })
    it('accepts zone at max length 64', () => {
      ok(commandSchema, { type: 'move', zone: str(64) })
    })
    it('rejects empty zone', () => {
      bad(commandSchema, { type: 'move', zone: '' })
    })
    it('rejects oversized zone', () => {
      bad(commandSchema, { type: 'move', zone: str(65) })
    })
    it('rejects missing zone', () => {
      bad(commandSchema, { type: 'move' })
    })
  })

  describe('cast', () => {
    it.each(['q', 'w', 'e', 'r'] as const)('accepts ability %s without target', (ability) => {
      ok(commandSchema, { type: 'cast', ability })
    })
    it('accepts cast with a target', () => {
      ok(commandSchema, { type: 'cast', ability: 'q', target: { kind: 'hero', name: 'axe' } })
      ok(commandSchema, { type: 'cast', ability: 'r', target: { kind: 'ancient' } })
      ok(commandSchema, { type: 'cast', ability: 'w', target: { kind: 'self' } })
    })
    it('rejects invalid ability key', () => {
      bad(commandSchema, { type: 'cast', ability: 'x' })
      bad(commandSchema, { type: 'cast', ability: 'Q' })
    })
    it('rejects missing ability', () => {
      bad(commandSchema, { type: 'cast' })
    })
    it('rejects malformed target', () => {
      bad(commandSchema, { type: 'cast', ability: 'q', target: { kind: 'hero' } })
    })
  })

  describe('use', () => {
    it('accepts item without target', () => {
      ok(commandSchema, { type: 'use', item: 'blink_dagger' })
    })
    it('accepts item with TargetRef target', () => {
      ok(commandSchema, {
        type: 'use',
        item: 'dagon',
        target: { kind: 'creep', index: 4 },
      })
    })
    it('accepts item with string target up to 64 chars', () => {
      ok(commandSchema, { type: 'use', item: 'tp_scroll', target: str(64) })
    })
    it('rejects string target over 64 chars', () => {
      bad(commandSchema, { type: 'use', item: 'tp_scroll', target: str(65) })
    })
    it('accepts item id at max length 128', () => {
      ok(commandSchema, { type: 'use', item: str(128) })
    })
    it('rejects item id over 128 chars', () => {
      bad(commandSchema, { type: 'use', item: str(129) })
    })
    it('rejects empty item', () => {
      bad(commandSchema, { type: 'use', item: '' })
    })
    it('rejects missing item', () => {
      bad(commandSchema, { type: 'use' })
    })
  })

  describe('buy / sell', () => {
    it('accepts valid buy and sell', () => {
      ok(commandSchema, { type: 'buy', item: 'boots' })
      ok(commandSchema, { type: 'sell', item: 'boots' })
    })
    it('enforces item length bounds', () => {
      ok(commandSchema, { type: 'buy', item: str(128) })
      bad(commandSchema, { type: 'buy', item: str(129) })
      bad(commandSchema, { type: 'buy', item: '' })
      bad(commandSchema, { type: 'sell', item: '' })
    })
    it('rejects missing item', () => {
      bad(commandSchema, { type: 'buy' })
      bad(commandSchema, { type: 'sell' })
    })
  })

  describe('ward', () => {
    it('accepts a valid ward placement', () => {
      ok(commandSchema, { type: 'ward', zone: 'river' })
    })
    it('rejects empty or oversized zone', () => {
      bad(commandSchema, { type: 'ward', zone: '' })
      bad(commandSchema, { type: 'ward', zone: str(65) })
    })
  })

  describe('bare commands', () => {
    it.each(['aegis', 'rune', 'scan', 'status', 'map', 'buyback', 'glyph'] as const)(
      'accepts bare %s command',
      (type) => {
        ok(commandSchema, { type })
      },
    )
  })

  describe('chat command', () => {
    it('accepts team and all channels', () => {
      ok(commandSchema, { type: 'chat', channel: 'team', message: 'gank mid' })
      ok(commandSchema, { type: 'chat', channel: 'all', message: 'gg' })
    })
    it('accepts message at max length 500', () => {
      ok(commandSchema, { type: 'chat', channel: 'all', message: str(500) })
    })
    it('rejects message over 500 chars', () => {
      bad(commandSchema, { type: 'chat', channel: 'all', message: str(501) })
    })
    it('rejects empty message', () => {
      bad(commandSchema, { type: 'chat', channel: 'team', message: '' })
    })
    it('rejects invalid channel', () => {
      bad(commandSchema, { type: 'chat', channel: 'global', message: 'hi' })
    })
    it('rejects missing fields', () => {
      bad(commandSchema, { type: 'chat', channel: 'team' })
      bad(commandSchema, { type: 'chat', message: 'hi' })
    })
  })

  describe('ping', () => {
    it('accepts a valid ping', () => {
      ok(commandSchema, { type: 'ping', zone: 'top_t1' })
    })
    it('rejects missing or invalid zone', () => {
      bad(commandSchema, { type: 'ping' })
      bad(commandSchema, { type: 'ping', zone: str(65) })
    })
  })

  describe('surrender', () => {
    it('accepts yes and no votes', () => {
      ok(commandSchema, { type: 'surrender', vote: 'yes' })
      ok(commandSchema, { type: 'surrender', vote: 'no' })
    })
    it('rejects invalid vote values', () => {
      bad(commandSchema, { type: 'surrender', vote: 'maybe' })
      bad(commandSchema, { type: 'surrender', vote: true })
      bad(commandSchema, { type: 'surrender' })
    })
  })

  describe('missing', () => {
    it('accepts a valid enemy id', () => {
      ok(commandSchema, { type: 'missing', enemyId: 'github_7379966' })
    })
    it('enforces enemyId length bounds', () => {
      ok(commandSchema, { type: 'missing', enemyId: str(128) })
      bad(commandSchema, { type: 'missing', enemyId: str(129) })
      bad(commandSchema, { type: 'missing', enemyId: '' })
      bad(commandSchema, { type: 'missing' })
    })
  })

  describe('deny', () => {
    it('accepts a creep deny within index bounds', () => {
      ok(commandSchema, { type: 'deny', target: { kind: 'creep', index: 0 } })
      ok(commandSchema, { type: 'deny', target: { kind: 'creep', index: 10_000 } })
    })
    it('rejects out-of-bounds index', () => {
      bad(commandSchema, { type: 'deny', target: { kind: 'creep', index: -1 } })
      bad(commandSchema, { type: 'deny', target: { kind: 'creep', index: 10_001 } })
    })
    it('rejects non-creep targets (deny is creep-only)', () => {
      bad(commandSchema, { type: 'deny', target: { kind: 'hero', name: 'axe' } })
      bad(commandSchema, { type: 'deny', target: { kind: 'ancient' } })
      bad(commandSchema, { type: 'deny', target: { kind: 'self' } })
    })
    it('rejects missing target', () => {
      bad(commandSchema, { type: 'deny' })
    })
  })

  describe('select_talent', () => {
    it.each([10, 15, 20, 25])('accepts tier %i', (tier) => {
      ok(commandSchema, { type: 'select_talent', tier, talentId: 'tal_q_dmg' })
    })
    it('rejects non-tier numbers', () => {
      bad(commandSchema, { type: 'select_talent', tier: 12, talentId: 't' })
      bad(commandSchema, { type: 'select_talent', tier: 30, talentId: 't' })
      bad(commandSchema, { type: 'select_talent', tier: 0, talentId: 't' })
    })
    it('rejects string tier', () => {
      bad(commandSchema, { type: 'select_talent', tier: '10', talentId: 't' })
    })
    it('enforces talentId bounds and presence', () => {
      ok(commandSchema, { type: 'select_talent', tier: 10, talentId: str(128) })
      bad(commandSchema, { type: 'select_talent', tier: 10, talentId: str(129) })
      bad(commandSchema, { type: 'select_talent', tier: 10, talentId: '' })
      bad(commandSchema, { type: 'select_talent', tier: 10 })
    })
  })

  describe('discriminator behaviour', () => {
    it('rejects unknown command types', () => {
      bad(commandSchema, { type: 'teleport', zone: 'mid' })
      bad(commandSchema, { type: 'hack' })
    })
    it('rejects missing type', () => {
      bad(commandSchema, { zone: 'mid' })
    })
    it('rejects non-object input', () => {
      bad(commandSchema, 'move')
      bad(commandSchema, 42)
      bad(commandSchema, null)
      bad(commandSchema, undefined)
      bad(commandSchema, ['move'])
    })
    it('strips unrecognized extra fields instead of keeping them', () => {
      const result = commandSchema.safeParse({ type: 'move', zone: 'mid', exploit: 'payload' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ type: 'move', zone: 'mid' })
        expect('exploit' in result.data).toBe(false)
      }
    })
  })
})

describe('clientMessageSchema', () => {
  describe('action', () => {
    it('accepts a valid wrapped command', () => {
      ok(clientMessageSchema, { type: 'action', command: { type: 'move', zone: 'mid' } })
      ok(clientMessageSchema, {
        type: 'action',
        command: { type: 'attack', target: { kind: 'ancient' } },
      })
    })
    it('rejects an invalid inner command', () => {
      bad(clientMessageSchema, { type: 'action', command: { type: 'fly' } })
      bad(clientMessageSchema, { type: 'action', command: { type: 'move' } })
    })
    it('rejects missing command', () => {
      bad(clientMessageSchema, { type: 'action' })
    })
  })

  describe('chat', () => {
    it('accepts valid chat messages on both channels', () => {
      ok(clientMessageSchema, { type: 'chat', channel: 'team', message: 'push top' })
      ok(clientMessageSchema, { type: 'chat', channel: 'all', message: str(500) })
    })
    it('rejects empty, oversized, or invalid-channel chats', () => {
      bad(clientMessageSchema, { type: 'chat', channel: 'team', message: '' })
      bad(clientMessageSchema, { type: 'chat', channel: 'all', message: str(501) })
      bad(clientMessageSchema, { type: 'chat', channel: 'whisper', message: 'hi' })
      bad(clientMessageSchema, { type: 'chat', message: 'hi' })
    })
    it('strips a spoofed playerId field (ws.ts stamps the sender AFTER spreading parsed data, so a surviving playerId would override it)', () => {
      const result = clientMessageSchema.safeParse({
        type: 'chat',
        channel: 'all',
        message: 'hi',
        playerId: 'someone_else',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ type: 'chat', channel: 'all', message: 'hi' })
      }
    })
  })

  describe('ping_map', () => {
    it('accepts a valid zone ping', () => {
      ok(clientMessageSchema, { type: 'ping_map', zone: 'river' })
      ok(clientMessageSchema, { type: 'ping_map', zone: str(64) })
    })
    it('rejects empty or oversized zones', () => {
      bad(clientMessageSchema, { type: 'ping_map', zone: '' })
      bad(clientMessageSchema, { type: 'ping_map', zone: str(65) })
      bad(clientMessageSchema, { type: 'ping_map' })
    })
  })

  describe('heartbeat', () => {
    it('accepts a bare heartbeat', () => {
      ok(clientMessageSchema, { type: 'heartbeat' })
    })
    it('strips extra fields from heartbeat', () => {
      const result = clientMessageSchema.safeParse({ type: 'heartbeat', payload: str(10_000) })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ type: 'heartbeat' })
      }
    })
  })

  describe('reconnect', () => {
    it('accepts reconnect without lastTick', () => {
      ok(clientMessageSchema, { type: 'reconnect', gameId: 'game_1', playerId: 'p_1' })
    })
    it('accepts reconnect with lastTick 0 (lower bound)', () => {
      ok(clientMessageSchema, { type: 'reconnect', gameId: 'g', playerId: 'p', lastTick: 0 })
    })
    it('accepts ids at max length 128', () => {
      ok(clientMessageSchema, { type: 'reconnect', gameId: str(128), playerId: str(128) })
    })
    it('rejects negative or fractional lastTick', () => {
      bad(clientMessageSchema, { type: 'reconnect', gameId: 'g', playerId: 'p', lastTick: -1 })
      bad(clientMessageSchema, { type: 'reconnect', gameId: 'g', playerId: 'p', lastTick: 1.5 })
    })
    it('rejects missing or oversized ids', () => {
      bad(clientMessageSchema, { type: 'reconnect', playerId: 'p' })
      bad(clientMessageSchema, { type: 'reconnect', gameId: 'g' })
      bad(clientMessageSchema, { type: 'reconnect', gameId: str(129), playerId: 'p' })
      bad(clientMessageSchema, { type: 'reconnect', gameId: '', playerId: 'p' })
    })
  })

  describe('join_game', () => {
    it('accepts a valid gameId', () => {
      ok(clientMessageSchema, { type: 'join_game', gameId: 'game_abc' })
      ok(clientMessageSchema, { type: 'join_game', gameId: str(128) })
    })
    it('rejects missing, empty, or oversized gameId', () => {
      bad(clientMessageSchema, { type: 'join_game' })
      bad(clientMessageSchema, { type: 'join_game', gameId: '' })
      bad(clientMessageSchema, { type: 'join_game', gameId: str(129) })
      bad(clientMessageSchema, { type: 'join_game', gameId: 17 })
    })
  })

  describe('hero_pick', () => {
    it('accepts valid lobby and hero ids', () => {
      ok(clientMessageSchema, { type: 'hero_pick', lobbyId: 'lobby_1', heroId: 'axe' })
      ok(clientMessageSchema, { type: 'hero_pick', lobbyId: str(128), heroId: str(128) })
    })
    it('rejects missing, empty, or oversized ids', () => {
      bad(clientMessageSchema, { type: 'hero_pick', heroId: 'axe' })
      bad(clientMessageSchema, { type: 'hero_pick', lobbyId: 'lobby_1' })
      bad(clientMessageSchema, { type: 'hero_pick', lobbyId: '', heroId: 'axe' })
      bad(clientMessageSchema, { type: 'hero_pick', lobbyId: str(129), heroId: 'axe' })
    })
  })

  describe('request_state', () => {
    it('accepts a bare request_state', () => {
      ok(clientMessageSchema, { type: 'request_state' })
    })
  })

  describe('spectate / unspectate', () => {
    it('accepts spectate with a gameId', () => {
      ok(clientMessageSchema, { type: 'spectate', gameId: 'game_1' })
    })
    it('rejects spectate without gameId', () => {
      bad(clientMessageSchema, { type: 'spectate' })
      bad(clientMessageSchema, { type: 'spectate', gameId: '' })
      bad(clientMessageSchema, { type: 'spectate', gameId: str(129) })
    })
    it('accepts a bare unspectate', () => {
      ok(clientMessageSchema, { type: 'unspectate' })
    })
  })

  describe('discriminator behaviour', () => {
    it('rejects unknown message types', () => {
      bad(clientMessageSchema, { type: 'admin_command', cmd: 'shutdown' })
      bad(clientMessageSchema, { type: 'eval', code: '1+1' })
      // server→client message types must not validate as client messages
      bad(clientMessageSchema, { type: 'error', code: 'X', message: 'm' })
      bad(clientMessageSchema, { type: 'full_state', tick: 1, state: {} })
    })
    it('rejects missing type', () => {
      bad(clientMessageSchema, { command: { type: 'move', zone: 'mid' } })
      bad(clientMessageSchema, {})
    })
    it('rejects non-object payloads', () => {
      bad(clientMessageSchema, 'heartbeat')
      bad(clientMessageSchema, 99)
      bad(clientMessageSchema, null)
      bad(clientMessageSchema, undefined)
      bad(clientMessageSchema, [{ type: 'heartbeat' }])
      bad(clientMessageSchema, true)
    })
    it('rejects type as non-string', () => {
      bad(clientMessageSchema, { type: 7 })
      bad(clientMessageSchema, { type: null })
      bad(clientMessageSchema, { type: { $: 'heartbeat' } })
    })
  })
})
