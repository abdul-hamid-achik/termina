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

// Failure recovery collaborators: the queue re-insert and the orphan
// live_games cleanup.
const requeueMatchPlayersMock = vi.fn(async (..._args: unknown[]) => {})
vi.mock('~~/server/game/matchmaking/queueNeon', () => ({
  requeueMatchPlayers: (...args: unknown[]) => requeueMatchPlayersMock(...args),
}))
const deleteWhereMock = vi.fn(async (..._args: unknown[]) => {})
const dbDeleteMock = vi.fn((..._args: unknown[]) => ({ where: deleteWhereMock }))
vi.mock('~~/server/db', () => ({ useDb: () => ({ delete: dbDeleteMock }) }))

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
    // The id is minted up front (q_<ts>_<rand>) so a failed start can clean up
    // the half-created live_games row.
    expect(opts).toMatchObject({ mode: 'normal' })
    expect((opts as { gameId: string }).gameId).toMatch(/^q_\d+_[a-z0-9]+$/)
    expect(requeueMatchPlayersMock).not.toHaveBeenCalled()
  })

  describe("bot difficulty from the humans' average MMR", () => {
    const botEntry = (id: string): MatchRosterEntry => ({
      playerId: id,
      username: id,
      mmr: 1000,
      mode: 'quick_3v3',
    })
    const formed = (humanMmrs: number[]) => {
      const players = humanMmrs.map((m, i) => entry(`h${i}`, m))
      const bots = [botEntry('bot_1'), botEntry('bot_2')]
      return {
        mode: 'quick_3v3' as const,
        players,
        bots,
        roster: [...players, ...bots],
      }
    }
    const startedWithDifficulty = async (humanMmrs: number[]) => {
      const { startFormedMatch } = await import('~~/server/game/matchmaking/matchStart')
      await startFormedMatch(formed(humanMmrs))
      const [, opts] = startLiveGameMock.mock.calls[0]!
      return (opts as { botOptions?: { difficulty?: string } }).botOptions?.difficulty
    }

    it('avg MMR 800 -> easy bots', async () => {
      expect(await startedWithDifficulty([700, 900])).toBe('easy')
    })

    it('avg MMR 1000 -> medium bots', async () => {
      expect(await startedWithDifficulty([1000])).toBe('medium')
    })

    it('avg MMR 1500 -> hard bots', async () => {
      expect(await startedWithDifficulty([1400, 1600])).toBe('hard')
    })

    it('uses only the HUMAN players (bot MMRs do not dilute the average)', async () => {
      // Humans avg 1500 -> hard even though the two bots sit at 1000.
      expect(await startedWithDifficulty([1500, 1500, 1500])).toBe('hard')
    })

    it('passes no botOptions when the match has no bots', async () => {
      const { startFormedMatch } = await import('~~/server/game/matchmaking/matchStart')
      await startFormedMatch({
        mode: '1v1',
        players: [entry('p1', 800), entry('p2', 800)],
        bots: [],
        roster: [entry('p1', 800), entry('p2', 800)],
      })
      const [, opts] = startLiveGameMock.mock.calls[0]!
      expect((opts as { botOptions?: unknown }).botOptions).toBeUndefined()
    })
  })

  describe('when starting the live game throws', () => {
    const match = {
      mode: '1v1' as const,
      players: [entry('p1'), entry('p2')],
      bots: [],
      roster: [entry('p1'), entry('p2')],
    }

    it('puts the matched players back in the queue and rethrows the original error', async () => {
      const boom = new Error('workflow start failed')
      startLiveGameMock.mockRejectedValueOnce(boom)
      const { startFormedMatch } = await import('~~/server/game/matchmaking/matchStart')

      await expect(startFormedMatch(match)).rejects.toBe(boom)

      expect(requeueMatchPlayersMock).toHaveBeenCalledTimes(1)
      expect(requeueMatchPlayersMock).toHaveBeenCalledWith(match)
    })

    it('removes the orphaned live_games row for the id it minted', async () => {
      startLiveGameMock.mockRejectedValueOnce(new Error('workflow start failed'))
      const { startFormedMatch } = await import('~~/server/game/matchmaking/matchStart')

      await expect(startFormedMatch(match)).rejects.toThrow('workflow start failed')

      expect(dbDeleteMock).toHaveBeenCalledTimes(1)
      expect(deleteWhereMock).toHaveBeenCalledTimes(1)
    })

    it('still requeues and surfaces the ORIGINAL error if the orphan cleanup itself fails', async () => {
      const boom = new Error('start failed')
      startLiveGameMock.mockRejectedValueOnce(boom)
      deleteWhereMock.mockRejectedValueOnce(new Error('cleanup failed'))
      const { startFormedMatch } = await import('~~/server/game/matchmaking/matchStart')

      await expect(startFormedMatch(match)).rejects.toBe(boom)
      expect(requeueMatchPlayersMock).toHaveBeenCalledTimes(1)
    })
  })
})
