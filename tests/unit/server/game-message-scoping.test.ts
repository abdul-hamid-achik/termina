/**
 * Which match a server-pushed message belongs to (server/plugins/game-server.ts).
 *
 * Nothing in the client-facing protocol carries a gameId: tick_state,
 * announcement and game_over are indistinguishable between matches once they
 * land. The game callbacks route purely by playerId, so an abandoned match that
 * finishes later — a practice game keeps ticking with zero input and reaches its
 * own game-over on the step deadlines — used to flood whatever match the player
 * had moved on to, and end it with a foreign scoreboard.
 *
 * game-server.ts calls defineNitroPlugin at module eval, so stub it before
 * import (same pattern as event-visibility.test.ts).
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  registerPeer,
  removePeer,
  setPlayerGame,
  clearPlayerGame,
  getPlayerGame,
} from '~~/server/services/PeerRegistry'

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn)

const { sendToGamePeer, stopDevGame } = await import('~~/server/plugins/game-server')

const TEST_PLAYERS = ['p_live', 'p_moved', 'p_tut', 'p_other']

function connect(playerId: string, gameId: string) {
  const send = vi.fn()
  registerPeer(playerId, { send }, { send })
  setPlayerGame(playerId, gameId)
  return send
}

beforeEach(() => {
  for (const pid of TEST_PLAYERS) {
    removePeer(pid)
    clearPlayerGame(pid)
  }
})

afterEach(() => {
  for (const pid of TEST_PLAYERS) {
    removePeer(pid)
    clearPlayerGame(pid)
  }
})

describe('sendToGamePeer', () => {
  it('delivers to a player still assigned to the sending game', () => {
    const send = connect('p_live', 'game_live')
    sendToGamePeer('game_live', 'p_live', { type: 'announcement', message: 'hi', level: 'info' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('drops a game_over from a match the player has already left', () => {
    // The abandoned practice game finishes while the player is mid-way through
    // a ranked match. Routing by playerId alone ended the live match.
    const send = connect('p_moved', 'game_ranked')
    sendToGamePeer('dev_abandoned', 'p_moved', {
      type: 'game_over',
      winner: 'radiant',
      stats: {},
      mmrChange: 0,
      ranked: false,
      durationTicks: 900,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('drops the stale board too, not just the verdict', () => {
    // Every tick of the dead game was being painted over the live one.
    const send = connect('p_moved', 'game_ranked')
    sendToGamePeer('dev_abandoned', 'p_moved', {
      type: 'tick_state',
      tick: 120,
      state: { tick: 120 } as never,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('drops messages for a player with no assignment at all', () => {
    const send = vi.fn()
    registerPeer('p_other', { send }, { send })
    sendToGamePeer('game_dead', 'p_other', {
      type: 'announcement',
      message: 'late',
      level: 'info',
    })
    expect(send).not.toHaveBeenCalled()
  })
})

/**
 * buildCallbacks is a closure created inside defineNitroPlugin over the Effect
 * runtime, the DB service and the game's state manager, so it cannot be called
 * from a unit test. Its send sites are exactly where the bug lived, so the
 * invariant is asserted against the source instead: every push out of a game
 * callback names the game it came from.
 */
function fnSource(signature: string): string {
  const src = readFileSync(
    new URL('../../../server/plugins/game-server.ts', import.meta.url),
    'utf8',
  )
  const start = src.indexOf(signature)
  expect(start).toBeGreaterThan(-1)
  const open = src.indexOf('{', src.indexOf(')', start))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`${signature} braces are unbalanced — the extractor needs fixing`)
}

describe('game callbacks route by game, not by player', () => {
  it('no callback pushes through the unscoped sendToPeer', () => {
    const body = fnSource('function buildCallbacks(')
    expect(body).toContain('sendToGamePeer(')
    expect(body).not.toContain('sendToPeer(')
  })

  it('the stale-game reaper releases only assignments still pointing at the reaped game', () => {
    // Same defect as the broadcast one, on the eviction side: a zombie game
    // reaped long after its players moved on used to unmap them from the match
    // they are in now — which stops presence being stamped, hands their hero to
    // the AFK bot takeover, and makes every reconnect answer NOT_ASSIGNED.
    expect(fnSource('function reapStaleLiveGames(')).toMatch(
      /if \(getPlayerGame\(pid\) === gameId\) clearPlayerGame\(pid\)/,
    )
  })
})

describe('stopDevGame', () => {
  it('releases the player→game assignment so the player is not stranded', () => {
    // REGRESSION: the WS grace timer stops an abandoned practice game but the
    // player stayed mapped to it. `reconnect` then passed the ownership check
    // into a game with no live state — a permanently frozen HUD — and both
    // queue/join and tutorial.post refused to start anything else.
    connect('p_tut', 'dev_1337_abcd')
    stopDevGame('dev_1337_abcd')
    expect(getPlayerGame('p_tut')).toBeUndefined()
  })

  it('leaves a player who already moved to another match alone', () => {
    connect('p_tut', 'dev_1337_abcd')
    connect('p_moved', 'game_ranked')
    stopDevGame('dev_1337_abcd')
    expect(getPlayerGame('p_moved')).toBe('game_ranked')
  })

  it('never touches a real match, whatever the caller passes', () => {
    connect('p_live', 'game_real')
    stopDevGame('game_real')
    expect(getPlayerGame('p_live')).toBe('game_real')
  })
})
