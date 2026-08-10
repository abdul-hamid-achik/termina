import { describe, it, expect } from 'vitest'
import { parseSpectatorMessage } from '~~/app/utils/spectatorMessage'

describe('parseSpectatorMessage', () => {
  it('parses a spectator_ack', () => {
    expect(parseSpectatorMessage(JSON.stringify({ type: 'spectator_ack', gameId: 'g1' }))).toEqual({
      type: 'ack',
      gameId: 'g1',
    })
  })

  it('parses a spectator_tick with tick + state', () => {
    const state = { teams: {}, players: {}, timeOfDay: 'day' }
    expect(
      parseSpectatorMessage(JSON.stringify({ type: 'spectator_tick', cycle: 42, state })),
    ).toEqual({ type: 'cycle', cycle: 42, state })
  })

  it('parses a spectator_delayed as an eta', () => {
    expect(
      parseSpectatorMessage(
        JSON.stringify({ type: 'spectator_delayed', gameId: 'g1', etaMs: 42_000 }),
      ),
    ).toEqual({ type: 'delayed', etaMs: 42_000 })
  })

  it('parses a spectator_game_over as a winner', () => {
    expect(
      parseSpectatorMessage(
        JSON.stringify({ type: 'spectator_game_over', gameId: 'g1', winner: 'chaff' }),
      ),
    ).toEqual({ type: 'game_over', winner: 'chaff' })
  })

  it('formats an error as "code: message"', () => {
    expect(
      parseSpectatorMessage(
        JSON.stringify({ type: 'error', code: 'not_found', message: 'no game' }),
      ),
    ).toEqual({ type: 'error', message: 'not_found: no game' })
  })

  it('ignores unparseable frames', () => {
    expect(parseSpectatorMessage('not json{')).toEqual({ type: 'ignore' })
  })

  it('ignores unknown message types', () => {
    expect(parseSpectatorMessage(JSON.stringify({ type: 'heartbeat' }))).toEqual({ type: 'ignore' })
  })

  it('accepts an already-parsed object too', () => {
    expect(parseSpectatorMessage({ type: 'spectator_ack', gameId: 'g2' })).toEqual({
      type: 'ack',
      gameId: 'g2',
    })
  })
})
