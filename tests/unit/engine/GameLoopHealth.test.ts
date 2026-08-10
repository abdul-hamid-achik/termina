import { afterEach, describe, expect, it } from 'vitest'
import {
  clearGameLoopHealth,
  getGameLoopHealthSummary,
  recordTickFailure,
  recordTickSuccess,
  TICK_FAILURE_NOTICE_THRESHOLD,
} from '~~/server/game/engine/GameLoopHealth'

const GAME_ID = 'health-test-game'

afterEach(() => {
  clearGameLoopHealth(GAME_ID)
})

describe('GameLoopHealth', () => {
  it('counts consecutive failures and marks a game degraded at the notice threshold', () => {
    recordTickFailure(GAME_ID)
    recordTickFailure(GAME_ID)
    expect(getGameLoopHealthSummary()).toEqual({
      degradedGames: 0,
      totalConsecutiveFailures: 2,
    })

    recordTickFailure(GAME_ID)
    expect(TICK_FAILURE_NOTICE_THRESHOLD).toBe(3)
    expect(getGameLoopHealthSummary()).toEqual({
      degradedGames: 1,
      totalConsecutiveFailures: 3,
    })
  })

  it('clears an incident after one healthy cycle', () => {
    recordTickFailure(GAME_ID)
    recordTickFailure(GAME_ID)
    recordTickSuccess(GAME_ID)
    expect(getGameLoopHealthSummary()).toEqual({
      degradedGames: 0,
      totalConsecutiveFailures: 0,
    })
  })
})
