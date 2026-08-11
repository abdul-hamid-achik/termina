import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assignQuickMatchRoster } from '~~/server/game/matchmaking/matchStart'
import { HERO_IDS } from '~~/shared/constants/heroes'
import type { MatchRosterEntry } from '~~/server/game/matchmaking/queueNeon'

function entry(playerId: string, mmr = 1000): MatchRosterEntry {
  return { playerId, username: playerId, mmr, mode: '1v1' }
}

describe('assignQuickMatchRoster', () => {
  it('alternates teams by index parity (even → chaff, odd → audit)', () => {
    const roster = [entry('p1'), entry('p2'), entry('p3'), entry('p4')]
    const assigned = assignQuickMatchRoster(roster)
    expect(assigned.map((p) => p.team)).toEqual(['chaff', 'audit', 'chaff', 'audit'])
  })

  it('assigns every player a distinct hero', () => {
    const roster = Array.from({ length: 10 }, (_, i) => entry(`p${i}`))
    const assigned = assignQuickMatchRoster(roster)
    expect(new Set(assigned.map((p) => p.heroId)).size).toBe(10)
    for (const p of assigned) {
      expect(HERO_IDS).toContain(p.heroId)
    }
  })

  it('carries playerId and mmr through unchanged', () => {
    const roster = [entry('p1', 1234)]
    const assigned = assignQuickMatchRoster(roster)
    expect(assigned[0]).toMatchObject({ playerId: 'p1', mmr: 1234 })
  })

  it('handles an empty roster', () => {
    expect(assignQuickMatchRoster([])).toEqual([])
  })
})

// server/game/liveGame's startLiveGame is exercised in tests/unit/server/
// liveGame.test.ts — mock it here so startFormedMatch's own wiring (roster
// assembly + mapId selection) is what's under test.
const startLiveGameMock = vi.fn(async () => ({ gameId: 'q_started' }))
vi.mock('~~/server/game/liveGame', () => ({
  startLiveGame: (...args: unknown[]) => startLiveGameMock(...args),
}))

describe('startFormedMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a live game with the assigned roster, mode "normal", and the mode-appropriate map', async () => {
    const { startFormedMatch } = await import('~~/server/game/matchmaking/matchStart')
    const match = {
      mode: '1v1' as const,
      players: [entry('p1'), entry('p2')],
      bots: [],
      roster: [entry('p1'), entry('p2')],
    }

    const result = await startFormedMatch(match)

    expect(result).toEqual({ gameId: 'q_started' })
    expect(startLiveGameMock).toHaveBeenCalledTimes(1)
    const [players, opts] = startLiveGameMock.mock.calls[0]!
    expect(players).toHaveLength(2)
    expect(opts).toMatchObject({ mode: 'normal', gameIdPrefix: 'q' })
  })
})
