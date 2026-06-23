/**
 * Unit tests for the WebSocket ingress route (server/routes/ws.ts).
 *
 * The route is a defineWebSocketHandler({ open, message, close, error })
 * object. We stub the two Nitro auto-import globals it relies on
 * (defineWebSocketHandler → identity, useRuntimeConfig → session secret)
 * BEFORE importing it, and mock every module dependency so the handlers can
 * be driven directly with mock peers. No source changes, no dev server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Effect } from 'effect'
import { createWsTicket } from '~~/server/utils/ws-ticket'
import { getGameRuntime, getReconnectPayload, stopDevGame } from '~~/server/plugins/game-server'
import { submitAction } from '~~/server/game/engine/GameLoop'
import {
  pickHero,
  getPlayerLobby,
  getLobby,
  cancelLobby,
  currentPickTurn,
} from '~~/server/game/matchmaking/lobby'
import {
  registerPeer,
  unregisterPeer,
  getPlayerGame,
  getPlayerTeam,
  sendToPeer,
} from '~~/server/services/PeerRegistry'
import { addSpectator, removeSpectator } from '~~/server/services/SpectatorRegistry'
import { checkRateLimit, checkScopedRateLimit, resetRateLimit } from '~~/server/utils/RateLimiter'

vi.mock('~~/server/plugins/game-server', () => ({
  getGameRuntime: vi.fn(),
  getReconnectPayload: vi.fn(),
  stopDevGame: vi.fn(),
}))
vi.mock('~~/server/game/engine/GameLoop', () => ({
  submitAction: vi.fn(),
}))
vi.mock('~~/server/game/matchmaking/lobby', () => ({
  pickHero: vi.fn(),
  getPlayerLobby: vi.fn(),
  getLobby: vi.fn(),
  cancelLobby: vi.fn(),
  currentPickTurn: vi.fn(() => null),
}))
vi.mock('~~/server/services/PeerRegistry', () => ({
  registerPeer: vi.fn(),
  unregisterPeer: vi.fn(),
  getPlayerGame: vi.fn(),
  getPlayerTeam: vi.fn(),
  sendToPeer: vi.fn(),
}))
vi.mock('~~/server/services/SpectatorRegistry', () => ({
  addSpectator: vi.fn(),
  removeSpectator: vi.fn(),
}))
vi.mock('~~/server/utils/RateLimiter', () => ({
  checkRateLimit: vi.fn(),
  checkScopedRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
}))
vi.mock('~~/server/utils/log', () => {
  const noopLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { wsLog: noopLog }
})

const TEST_SECRET = 'unit-test-session-secret-0123456789'

// Nitro auto-imports used by the route at module-eval / open() time.
vi.stubGlobal('defineWebSocketHandler', (hooks: unknown) => hooks)
vi.stubGlobal('useRuntimeConfig', () => ({ session: { password: TEST_SECRET } }))

const handler = (await import('~~/server/routes/ws')).default as unknown as {
  open: (peer: unknown) => void
  message: (peer: unknown, message: unknown) => void
  close: (peer: unknown, details: unknown) => void
  error: (peer: unknown, error: unknown) => void
}

interface MockPeer {
  request: { url: string; __authSession?: { user: { id: string } } | null }
  websocket: { send: ReturnType<typeof vi.fn>; url?: string }
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function createPeer(opts: { url?: string; sessionPlayerId?: string } = {}): MockPeer {
  const peer: MockPeer = {
    request: { url: opts.url ?? '/ws' },
    websocket: { send: vi.fn() },
    send: vi.fn(),
    close: vi.fn(),
  }
  if (opts.sessionPlayerId) {
    peer.request.__authSession = { user: { id: opts.sessionPlayerId } }
  }
  return peer
}

function sentMessages(peer: MockPeer): Array<Record<string, unknown>> {
  return peer.send.mock.calls.map((call) => JSON.parse(call[0] as string))
}

function lastMessage(peer: MockPeer): Record<string, unknown> | undefined {
  const msgs = sentMessages(peer)
  return msgs[msgs.length - 1]
}

/** Open an authenticated peer and clear the connection-time sends. */
function openAuthedPeer(playerId: string): MockPeer {
  const peer = createPeer({ sessionPlayerId: playerId })
  handler.open(peer)
  peer.send.mockClear()
  return peer
}

function sendMsg(peer: MockPeer, msg: unknown): void {
  handler.message(peer, typeof msg === 'string' ? msg : JSON.stringify(msg))
}

function mockRuntime() {
  return {
    wsService: {
      addConnection: vi.fn(() => Effect.succeed(undefined)),
      getConnections: vi.fn(() => Effect.succeed(new Map([['other_player', {}]]))),
      removeConnection: vi.fn(() => Effect.succeed(undefined)),
      broadcastToGame: vi.fn(() => Effect.succeed(undefined)),
    },
    redisService: {
      publish: vi.fn(() => Effect.succeed(undefined)),
      hset: vi.fn(() => Effect.succeed(undefined)),
      hget: vi.fn(() => Effect.succeed(null)),
      hdel: vi.fn(() => Effect.succeed(undefined)),
      hgetall: vi.fn(() => Effect.succeed({})),
    },
    dbService: { tag: 'db' },
  }
}

/** Authenticated peer that has joined gameId (sets ctx.gameId via join_game). */
function openPeerInGame(playerId: string, gameId: string, runtime = mockRuntime()) {
  vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
  const peer = openAuthedPeer(playerId)
  vi.mocked(getPlayerGame).mockReturnValue(gameId)
  sendMsg(peer, { type: 'join_game', gameId })
  peer.send.mockClear()
  return { peer, runtime }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Defaults: not in a game, not in a lobby, rate limits open, no runtime.
  vi.mocked(getPlayerGame).mockReturnValue(undefined)
  vi.mocked(getPlayerLobby).mockReturnValue(undefined)
  vi.mocked(getLobby).mockReturnValue(undefined)
  vi.mocked(checkRateLimit).mockReturnValue(true)
  vi.mocked(checkScopedRateLimit).mockReturnValue(true)
  vi.mocked(getGameRuntime).mockReturnValue(null)
  vi.mocked(getReconnectPayload).mockReturnValue(null as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ws route — open()', () => {
  it('rejects direct bot connections with close 4003 even when authenticated', () => {
    const peer = createPeer({ url: '/ws?playerId=bot_42', sessionPlayerId: 'bot_42' })
    handler.open(peer)
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'BOT_CONNECTION_FORBIDDEN' })
    expect(peer.close).toHaveBeenCalledWith(4003, expect.any(String))
    expect(registerPeer).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated connections with close 4001', () => {
    const peer = createPeer()
    handler.open(peer)
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'AUTH_REQUIRED' })
    expect(peer.close).toHaveBeenCalledWith(4001, expect.any(String))
    expect(registerPeer).not.toHaveBeenCalled()
  })

  it('authenticates via session and registers the peer', () => {
    const peer = createPeer({ sessionPlayerId: 'github_123' })
    handler.open(peer)
    expect(registerPeer).toHaveBeenCalledWith('github_123', peer, peer.websocket)
    expect(peer.close).not.toHaveBeenCalled()
    expect(sentMessages(peer)).toContainEqual(
      expect.objectContaining({ type: 'announcement', message: 'Connected to TERMINA' }),
    )
  })

  it('falls back to a valid signed ticket when no session is present', () => {
    const ticket = createWsTicket('ticket_player', TEST_SECRET)
    const peer = createPeer({ url: `/ws?ticket=${encodeURIComponent(ticket)}` })
    handler.open(peer)
    expect(registerPeer).toHaveBeenCalledWith('ticket_player', peer, peer.websocket)
    expect(peer.close).not.toHaveBeenCalled()
  })

  it('rejects a ticket signed with the wrong secret', () => {
    const ticket = createWsTicket('forged_player', 'some-other-secret-entirely-here')
    const peer = createPeer({ url: `/ws?ticket=${encodeURIComponent(ticket)}` })
    handler.open(peer)
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'AUTH_REQUIRED' })
    expect(peer.close).toHaveBeenCalledWith(4001, expect.any(String))
    expect(registerPeer).not.toHaveBeenCalled()
  })

  it('re-sends game_starting when the player is already assigned to a game', () => {
    vi.mocked(getPlayerGame).mockReturnValue('game_77')
    const peer = createPeer({ sessionPlayerId: 'p_reconnect' })
    handler.open(peer)
    expect(sentMessages(peer)).toContainEqual({ type: 'game_starting', gameId: 'game_77' })
  })

  it('broadcasts player_reconnect when a dropped player returns within the window', () => {
    vi.useFakeTimers()
    const { peer, runtime } = openPeerInGame('p_rc', 'game_rc')
    handler.close(peer, {}) // in-game disconnect → schedules the reconnect-window timer

    // The same player reconnects before the window expires → a genuine reconnect.
    vi.mocked(getPlayerGame).mockReturnValue('game_rc')
    openAuthedPeer('p_rc')

    expect(runtime.wsService.broadcastToGame).toHaveBeenCalledWith('game_rc', {
      type: 'player_reconnect',
      playerId: 'p_rc',
    })
  })

  it('does NOT announce a reconnect on a first connect (existingGame, no prior disconnect)', () => {
    const runtime = mockRuntime()
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    vi.mocked(getPlayerGame).mockReturnValue('game_x')
    openAuthedPeer('p_first') // no pending disconnect timer → wasReconnecting is false
    expect(runtime.wsService.broadcastToGame).not.toHaveBeenCalled()
  })

  it('re-sends lobby_state when the player is in a lobby but not a game', () => {
    vi.mocked(getPlayerLobby).mockReturnValue('lobby_9')
    vi.mocked(getLobby).mockReturnValue({
      players: [
        { playerId: 'p_lobby', username: 'abdul', team: 'dire', heroId: 'axe' },
        { playerId: 'p_other', username: 'mate', team: 'radiant', heroId: null },
      ],
    } as never)
    const peer = createPeer({ sessionPlayerId: 'p_lobby' })
    handler.open(peer)
    const lobbyMsg = sentMessages(peer).find((m) => m.type === 'lobby_state')
    expect(lobbyMsg).toMatchObject({ lobbyId: 'lobby_9', team: 'dire' })
    expect((lobbyMsg as { players: unknown[] }).players).toHaveLength(2)
  })

  it('also re-sends pick_turn on reconnect so the client learns whose turn it is', () => {
    vi.mocked(getPlayerLobby).mockReturnValue('lobby_9')
    vi.mocked(getLobby).mockReturnValue({
      players: [{ playerId: 'p_lobby', username: 'abdul', team: 'dire', heroId: null }],
    } as never)
    vi.mocked(currentPickTurn).mockReturnValue({
      type: 'pick_turn',
      playerId: 'p_lobby',
      username: 'abdul',
      timeRemainingMs: 15000,
    })
    const peer = createPeer({ sessionPlayerId: 'p_lobby' })
    handler.open(peer)
    const turnMsg = sentMessages(peer).find((m) => m.type === 'pick_turn')
    expect(turnMsg).toMatchObject({ playerId: 'p_lobby', username: 'abdul' })
  })
})

describe('ws route — message() ingress guards', () => {
  it('rejects messages from peers that never authenticated', () => {
    const peer = createPeer() // open() never called → no peer context
    sendMsg(peer, { type: 'heartbeat' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NOT_AUTHENTICATED' })
  })

  it('rejects non-JSON payloads with INVALID_JSON', () => {
    const peer = openAuthedPeer('p_json')
    sendMsg(peer, 'not json {{{')
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'INVALID_JSON' })
  })

  it('rejects oversized messages with MESSAGE_TOO_LARGE before parsing', () => {
    const peer = openAuthedPeer('p_big')
    const huge = JSON.stringify({ type: 'chat', channel: 'all', message: 'x'.repeat(20_000) })
    sendMsg(peer, huge)
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'MESSAGE_TOO_LARGE' })
  })

  it('rejects schema-invalid messages with INVALID_MESSAGE', () => {
    const peer = openAuthedPeer('p_schema')
    sendMsg(peer, { type: 'action', command: { type: 'fly_hack' } })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'INVALID_MESSAGE' })
    expect(submitAction).not.toHaveBeenCalled()
  })

  it('rejects unknown message types with INVALID_MESSAGE', () => {
    const peer = openAuthedPeer('p_unknown')
    sendMsg(peer, { type: 'admin_eval', code: 'process.exit(1)' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'INVALID_MESSAGE' })
  })
})

describe('ws route — heartbeat', () => {
  it('answers heartbeat with heartbeat_ack and a timestamp', () => {
    const peer = openAuthedPeer('p_hb')
    sendMsg(peer, { type: 'heartbeat' })
    const msg = lastMessage(peer)
    expect(msg).toMatchObject({ type: 'heartbeat_ack' })
    expect(typeof msg?.timestamp).toBe('number')
  })
})

describe('ws route — action', () => {
  it('rejects actions before joining a game with NO_GAME', () => {
    const peer = openAuthedPeer('p_nogame')
    sendMsg(peer, { type: 'action', command: { type: 'move', zone: 'mid' } })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NO_GAME' })
    expect(submitAction).not.toHaveBeenCalled()
  })

  it('submits a valid action to the game loop', () => {
    const { peer } = openPeerInGame('p_act', 'game_1')
    sendMsg(peer, { type: 'action', command: { type: 'attack', target: { kind: 'ancient' } } })
    expect(submitAction).toHaveBeenCalledWith('game_1', 'p_act', {
      type: 'attack',
      target: { kind: 'ancient' },
    })
  })

  it('drops rate-limited actions with RATE_LIMITED and never submits them', () => {
    const { peer } = openPeerInGame('p_spam', 'game_1')
    vi.mocked(checkRateLimit).mockReturnValue(false)
    sendMsg(peer, { type: 'action', command: { type: 'move', zone: 'mid' } })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'RATE_LIMITED' })
    expect(submitAction).not.toHaveBeenCalled()
  })

  it('rate-limits request_state via the recovery scope', () => {
    const peer = openAuthedPeer('p_rs_rl')
    vi.mocked(checkScopedRateLimit).mockReturnValue(false)
    sendMsg(peer, { type: 'request_state' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'RATE_LIMITED' })
  })

  it('rate-limits reconnect via the recovery scope', () => {
    const peer = openAuthedPeer('p_rc_rl')
    vi.mocked(checkScopedRateLimit).mockReturnValue(false)
    sendMsg(peer, { type: 'reconnect', gameId: 'game_x', playerId: 'p_rc_rl' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'RATE_LIMITED' })
  })
})

describe('ws route — reconnect ownership', () => {
  it('rejects reconnecting into a game the player is not assigned to', () => {
    vi.mocked(getGameRuntime).mockReturnValue(mockRuntime() as never)
    const peer = openAuthedPeer('p_rc_own1')
    vi.mocked(getPlayerGame).mockReturnValue('game_mine')
    sendMsg(peer, { type: 'reconnect', gameId: 'game_other', playerId: 'p_rc_own1' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NOT_ASSIGNED' })
  })

  it('reconnects when the gameId matches the assigned game', () => {
    const runtime = mockRuntime()
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    const peer = openAuthedPeer('p_rc_own2')
    vi.mocked(getPlayerGame).mockReturnValue('game_mine')
    sendMsg(peer, { type: 'reconnect', gameId: 'game_mine', playerId: 'p_rc_own2' })
    expect(runtime.wsService.addConnection).toHaveBeenCalledWith(
      'game_mine',
      'p_rc_own2',
      peer.websocket,
    )
  })
})

describe('ws route — join_game', () => {
  it('does nothing when the game runtime is not ready', () => {
    const peer = openAuthedPeer('p_join')
    sendMsg(peer, { type: 'join_game', gameId: 'game_1' })
    expect(peer.send).not.toHaveBeenCalled()
  })

  it('rejects joining a game the player is not assigned to', () => {
    vi.mocked(getGameRuntime).mockReturnValue(mockRuntime() as never)
    vi.mocked(getPlayerGame).mockReturnValue('game_other')
    const peer = openAuthedPeer('p_join2')
    sendMsg(peer, { type: 'join_game', gameId: 'game_1' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NOT_ASSIGNED' })
  })

  it('adds the connection and confirms when assigned', () => {
    const runtime = mockRuntime()
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    const peer = openAuthedPeer('p_join3')
    vi.mocked(getPlayerGame).mockReturnValue('game_1')
    sendMsg(peer, { type: 'join_game', gameId: 'game_1' })
    expect(runtime.wsService.addConnection).toHaveBeenCalledWith(
      'game_1',
      'p_join3',
      peer.websocket,
    )
    expect(lastMessage(peer)).toMatchObject({ type: 'announcement', message: 'Joined game' })
  })

  it('does not grant game context on a failed join (subsequent actions still NO_GAME)', () => {
    vi.mocked(getGameRuntime).mockReturnValue(mockRuntime() as never)
    vi.mocked(getPlayerGame).mockReturnValue('game_other')
    const peer = openAuthedPeer('p_join5')
    sendMsg(peer, { type: 'join_game', gameId: 'game_1' })
    peer.send.mockClear()
    sendMsg(peer, { type: 'action', command: { type: 'move', zone: 'mid' } })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NO_GAME' })
    expect(submitAction).not.toHaveBeenCalled()
  })

  it('survives an addConnection failure without throwing', () => {
    const runtime = mockRuntime()
    runtime.wsService.addConnection = vi.fn(() => {
      throw new Error('boom')
    }) as never
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    const peer = openAuthedPeer('p_join4')
    vi.mocked(getPlayerGame).mockReturnValue('game_1')
    expect(() => sendMsg(peer, { type: 'join_game', gameId: 'game_1' })).not.toThrow()
  })
})

describe('ws route — reconnect', () => {
  it('fails with NO_GAME_SERVER when the runtime is not ready', () => {
    const peer = openAuthedPeer('p_rc0')
    sendMsg(peer, { type: 'reconnect', gameId: 'game_1', playerId: 'p_rc0' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NO_GAME_SERVER' })
  })

  it('re-adds the connection and replays full state plus missed events', () => {
    const runtime = mockRuntime()
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    vi.mocked(getReconnectPayload).mockReturnValue({
      tick: 42,
      state: { tick: 42, zones: {} },
      events: [{ type: 'kill', tick: 41 }],
    } as never)
    const peer = openAuthedPeer('p_rc1')
    vi.mocked(getPlayerGame).mockReturnValue('game_1') // reconnect requires ownership
    sendMsg(peer, { type: 'reconnect', gameId: 'game_1', playerId: 'p_rc1', lastTick: 40 })

    expect(runtime.wsService.addConnection).toHaveBeenCalledWith('game_1', 'p_rc1', peer.websocket)
    expect(getReconnectPayload).toHaveBeenCalledWith('game_1', 'p_rc1', 40)
    const msgs = sentMessages(peer)
    expect(msgs).toContainEqual(
      expect.objectContaining({ type: 'announcement', message: 'Reconnected to game' }),
    )
    expect(msgs).toContainEqual(expect.objectContaining({ type: 'full_state', tick: 42 }))
    expect(msgs).toContainEqual(
      expect.objectContaining({ type: 'events', tick: 42, events: [{ type: 'kill', tick: 41 }] }),
    )
  })

  it('omits the events message when there are no missed events', () => {
    const runtime = mockRuntime()
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    vi.mocked(getReconnectPayload).mockReturnValue({
      tick: 7,
      state: {},
      events: [],
    } as never)
    const peer = openAuthedPeer('p_rc2')
    vi.mocked(getPlayerGame).mockReturnValue('game_1') // reconnect requires ownership
    sendMsg(peer, { type: 'reconnect', gameId: 'game_1', playerId: 'p_rc2' })
    const msgs = sentMessages(peer)
    expect(msgs.some((m) => m.type === 'full_state')).toBe(true)
    expect(msgs.some((m) => m.type === 'events')).toBe(false)
  })

  it('reports RECONNECT_FAILED when addConnection throws', () => {
    const runtime = mockRuntime()
    runtime.wsService.addConnection = vi.fn(() => {
      throw new Error('connection table full')
    }) as never
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    const peer = openAuthedPeer('p_rc3')
    vi.mocked(getPlayerGame).mockReturnValue('game_1') // reconnect requires ownership
    sendMsg(peer, { type: 'reconnect', gameId: 'game_1', playerId: 'p_rc3' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'RECONNECT_FAILED' })
  })
})

describe('ws route — request_state', () => {
  it('rejects with NO_GAME when not in a game', () => {
    const peer = openAuthedPeer('p_rs0')
    sendMsg(peer, { type: 'request_state' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NO_GAME' })
  })

  it('returns full_state for the joined game', () => {
    const { peer } = openPeerInGame('p_rs1', 'game_5')
    vi.mocked(getReconnectPayload).mockReturnValue({
      tick: 9,
      state: { tick: 9 },
      events: [],
    } as never)
    sendMsg(peer, { type: 'request_state' })
    expect(getReconnectPayload).toHaveBeenCalledWith('game_5', 'p_rs1')
    expect(lastMessage(peer)).toMatchObject({ type: 'full_state', tick: 9 })
  })

  it('returns game_not_found when the game state is gone', () => {
    const { peer } = openPeerInGame('p_rs2', 'game_5')
    vi.mocked(getReconnectPayload).mockReturnValue(null as never)
    sendMsg(peer, { type: 'request_state' })
    expect(lastMessage(peer)).toMatchObject({ type: 'game_not_found', gameId: 'game_5' })
  })
})

describe('ws route — hero_pick', () => {
  it('applies the lobby-scoped rate limit', () => {
    vi.mocked(checkScopedRateLimit).mockReturnValue(false)
    const peer = openAuthedPeer('p_hp0')
    sendMsg(peer, { type: 'hero_pick', lobbyId: 'lobby_1', heroId: 'axe' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'RATE_LIMITED' })
    expect(pickHero).not.toHaveBeenCalled()
  })

  it('fails with NO_GAME_SERVER when the runtime is not ready', () => {
    const peer = openAuthedPeer('p_hp1')
    sendMsg(peer, { type: 'hero_pick', lobbyId: 'lobby_1', heroId: 'axe' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NO_GAME_SERVER' })
  })

  it('delegates to pickHero with runtime services and stays silent on success', () => {
    const runtime = mockRuntime()
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    vi.mocked(pickHero).mockReturnValue({ success: true } as never)
    const peer = openAuthedPeer('p_hp2')
    sendMsg(peer, { type: 'hero_pick', lobbyId: 'lobby_1', heroId: 'axe' })
    expect(pickHero).toHaveBeenCalledWith(
      'lobby_1',
      'p_hp2',
      'axe',
      runtime.wsService,
      runtime.redisService,
      runtime.dbService,
    )
    expect(sentMessages(peer).some((m) => m.type === 'error')).toBe(false)
  })

  it('relays a pick failure as PICK_FAILED with the lobby error message', () => {
    vi.mocked(getGameRuntime).mockReturnValue(mockRuntime() as never)
    vi.mocked(pickHero).mockReturnValue({ success: false, error: 'Hero already taken' } as never)
    const peer = openAuthedPeer('p_hp3')
    sendMsg(peer, { type: 'hero_pick', lobbyId: 'lobby_1', heroId: 'axe' })
    expect(lastMessage(peer)).toMatchObject({
      type: 'error',
      code: 'PICK_FAILED',
      message: 'Hero already taken',
    })
  })
})

describe('ws route — chat / ping_map fan-out', () => {
  it('rejects chat with NO_GAME when not in a game', () => {
    const peer = openAuthedPeer('p_chat0')
    sendMsg(peer, { type: 'chat', channel: 'team', message: 'hi' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'NO_GAME' })
  })

  it('fans chat out to every connection in the game, stamped with the sender id', async () => {
    const { peer } = openPeerInGame('p_chat1', 'game_1')
    sendMsg(peer, { type: 'chat', channel: 'all', message: 'gg wp' })
    await vi.waitFor(() => {
      expect(sendToPeer).toHaveBeenCalledWith('other_player', {
        playerId: 'p_chat1',
        type: 'chat',
        channel: 'all',
        message: 'gg wp',
      })
    })
  })

  it('fans ping_map out the same way', async () => {
    const { peer } = openPeerInGame('p_ping1', 'game_1')
    sendMsg(peer, { type: 'ping_map', zone: 'river' })
    await vi.waitFor(() => {
      expect(sendToPeer).toHaveBeenCalledWith('other_player', {
        playerId: 'p_ping1',
        type: 'ping_map',
        zone: 'river',
      })
    })
  })

  it('cannot spoof the sender: a client-supplied playerId is stripped, not fanned out', async () => {
    // ws.ts builds outMsg as { playerId: ctx.playerId, ...parsed } — parsed is
    // spread LAST, so identity integrity depends on the schema stripping the
    // unknown playerId field. If anyone makes the chat schema passthrough,
    // this test fails and flags the chat-impersonation hole.
    const { peer } = openPeerInGame('p_chat2', 'game_1')
    sendMsg(peer, { type: 'chat', channel: 'all', message: 'hi', playerId: 'victim_player' })
    await vi.waitFor(() => {
      expect(sendToPeer).toHaveBeenCalledWith('other_player', {
        playerId: 'p_chat2',
        type: 'chat',
        channel: 'all',
        message: 'hi',
      })
    })
    expect(sendToPeer).not.toHaveBeenCalledWith(
      'other_player',
      expect.objectContaining({ playerId: 'victim_player' }),
    )
  })

  // Three connections across two teams; the team cache (set on join_game)
  // provides O(1) team lookups for chat/ping routing.
  function openTeamGame(senderId: string) {
    const { peer, runtime } = openPeerInGame(senderId, 'game_tt')
    runtime.wsService.getConnections = vi.fn(() =>
      Effect.succeed(
        new Map<string, object>([
          [senderId, {}],
          ['mate', {}],
          ['enemy', {}],
        ]),
      ),
    )
    // Mock the team cache: sender + mate are radiant, enemy is dire.
    vi.mocked(getPlayerTeam).mockImplementation((id: string) => {
      if (id === senderId || id === 'mate') return 'radiant'
      if (id === 'enemy') return 'dire'
      return undefined
    })
    return peer
  }

  it('keeps team chat to the sender team — the enemy never receives it', async () => {
    const peer = openTeamGame('s_team')
    sendMsg(peer, { type: 'chat', channel: 'team', message: 'gank mid' })
    await vi.waitFor(() => {
      expect(sendToPeer).toHaveBeenCalledWith('mate', expect.objectContaining({ channel: 'team' }))
    })
    expect(sendToPeer).not.toHaveBeenCalledWith('enemy', expect.anything())
  })

  it('keeps map pings team-only — the enemy never sees where you looked', async () => {
    const peer = openTeamGame('s_ping')
    sendMsg(peer, { type: 'ping_map', zone: 'roshan-pit' })
    await vi.waitFor(() => {
      expect(sendToPeer).toHaveBeenCalledWith('mate', expect.objectContaining({ type: 'ping_map' }))
    })
    expect(sendToPeer).not.toHaveBeenCalledWith('enemy', expect.anything())
  })

  it('still fans ALL chat to everyone, enemies included', async () => {
    const peer = openTeamGame('s_all')
    sendMsg(peer, { type: 'chat', channel: 'all', message: 'gg' })
    await vi.waitFor(() => {
      expect(sendToPeer).toHaveBeenCalledWith('enemy', expect.objectContaining({ channel: 'all' }))
    })
  })
})

describe('ws route — spectator gating', () => {
  it('forbids spectating a game the player is participating in', () => {
    vi.mocked(getPlayerGame).mockReturnValue('game_1')
    const peer = openAuthedPeer('p_spec0')
    sendMsg(peer, { type: 'spectate', gameId: 'game_1' })
    expect(lastMessage(peer)).toMatchObject({ type: 'error', code: 'SPECTATE_FORBIDDEN' })
    expect(addSpectator).not.toHaveBeenCalled()
  })

  it('subscribes a non-participant as a spectator and acks', () => {
    vi.mocked(getPlayerGame).mockReturnValue('game_other')
    const peer = openAuthedPeer('p_spec1')
    sendMsg(peer, { type: 'spectate', gameId: 'game_1' })
    expect(addSpectator).toHaveBeenCalledWith(
      'p_spec1',
      'game_1',
      expect.objectContaining({ send: expect.any(Function) }),
    )
    expect(lastMessage(peer)).toMatchObject({ type: 'spectator_ack', gameId: 'game_1' })
  })

  it('unsubscribes on unspectate', () => {
    const peer = openAuthedPeer('p_spec2')
    sendMsg(peer, { type: 'unspectate' })
    expect(removeSpectator).toHaveBeenCalledWith('p_spec2')
  })
})

describe('ws route — close()', () => {
  it('ignores close for peers that never authenticated', () => {
    const peer = createPeer()
    expect(() => handler.close(peer, {})).not.toThrow()
    expect(unregisterPeer).not.toHaveBeenCalled()
  })

  it('unregisters, removes spectator, and resets rate limit immediately when not in a game', () => {
    const peer = openAuthedPeer('p_cl0')
    handler.close(peer, {})
    expect(unregisterPeer).toHaveBeenCalledWith('p_cl0', peer)
    expect(removeSpectator).toHaveBeenCalledWith('p_cl0')
    expect(resetRateLimit).toHaveBeenCalledWith('p_cl0')
  })

  it('defers in-game cleanup for the 60s reconnect window, then broadcasts the disconnect', async () => {
    vi.useFakeTimers()
    const { peer, runtime } = openPeerInGame('p_cl1', 'game_1')
    handler.close(peer, {})

    // Inside the window: nothing torn down yet.
    expect(resetRateLimit).not.toHaveBeenCalled()
    expect(runtime.wsService.removeConnection).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(resetRateLimit).toHaveBeenCalledWith('p_cl1')
    expect(runtime.wsService.removeConnection).toHaveBeenCalledWith('p_cl1')
    // Delivered to the surviving players via the real in-memory broadcast — NOT
    // the old Redis publish, which went to a channel with no subscriber.
    expect(runtime.wsService.broadcastToGame).toHaveBeenCalledWith('game_1', {
      type: 'player_disconnect',
      playerId: 'p_cl1',
    })
  })

  it('uses a short window for dev_ games and stops the seeded loop', async () => {
    vi.useFakeTimers()
    const { peer, runtime } = openPeerInGame('p_dev1', 'dev_1337_abcd')
    handler.close(peer, {})

    // Still inside the 3s dev window: nothing torn down, loop still running.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(runtime.wsService.removeConnection).not.toHaveBeenCalled()
    expect(stopDevGame).not.toHaveBeenCalled()

    // Past the 3s dev window (well before the 60s real-game window): cleanup runs
    // and the seeded game's loop is stopped so dev games don't pile up.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(runtime.wsService.removeConnection).toHaveBeenCalledWith('p_dev1')
    expect(stopDevGame).toHaveBeenCalledWith('dev_1337_abcd')
  })

  it('cancels the in-game cleanup when the player reconnects within the window', async () => {
    vi.useFakeTimers()
    const { peer, runtime } = openPeerInGame('p_cl2', 'game_1')
    handler.close(peer, {})

    await vi.advanceTimersByTimeAsync(30_000)
    // Reconnect: a fresh open() for the same playerId clears the timer.
    const reconnectedPeer = createPeer({ sessionPlayerId: 'p_cl2' })
    handler.open(reconnectedPeer)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(runtime.wsService.removeConnection).not.toHaveBeenCalled()
    expect(runtime.redisService.publish).not.toHaveBeenCalled()
  })

  it('starts a lobby grace period and cancels the lobby when it expires', async () => {
    vi.useFakeTimers()
    const runtime = mockRuntime()
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    vi.mocked(getPlayerLobby).mockReturnValue('lobby_3')
    const peer = openAuthedPeer('p_cl3')
    handler.close(peer, {})

    expect(cancelLobby).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cancelLobby).toHaveBeenCalledWith('lobby_3', runtime.wsService)
  })

  it('does not cancel the lobby if the player left it during the grace period', async () => {
    vi.useFakeTimers()
    const runtime = mockRuntime()
    vi.mocked(getGameRuntime).mockReturnValue(runtime as never)
    vi.mocked(getPlayerLobby).mockReturnValue('lobby_4')
    const peer = openAuthedPeer('p_cl4')
    handler.close(peer, {})

    // Lobby resolved (e.g. game started) before grace period expired.
    vi.mocked(getPlayerLobby).mockReturnValue(undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cancelLobby).not.toHaveBeenCalled()
  })
})

describe('ws route — error()', () => {
  it('logs without throwing', () => {
    const peer = createPeer({ sessionPlayerId: 'p_err' })
    expect(() => handler.error(peer, new Error('socket reset'))).not.toThrow()
  })
})
