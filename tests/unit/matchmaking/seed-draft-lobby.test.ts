import { describe, it, expect } from 'vitest'
import {
  seedDraftLobby,
  getLobby,
  getPlayerLobby,
  currentPickTurn,
  cleanupLobby,
} from '../../../server/game/matchmaking/lobby'

describe('seedDraftLobby (dev/test draft seeder)', () => {
  it('prepick 9: human is the final picker with 9 bots already picked', () => {
    const lobby = seedDraftLobby({ humanId: 'u_final', humanUsername: 'u_final', prepick: 9 })
    try {
      expect(lobby.players).toHaveLength(10)
      // Snake pick order's last slot (index 9) is the human's turn.
      expect(lobby.currentPickIndex).toBe(9)
      const human = lobby.players.find((p) => p.playerId === 'u_final')
      expect(human).toBeDefined()
      expect(human!.heroId).toBeNull() // human hasn't picked yet
      // The 9 non-human players have distinct heroes pre-picked.
      const bots = lobby.players.filter((p) => p.playerId !== 'u_final')
      expect(bots).toHaveLength(9)
      expect(bots.every((b) => b.heroId !== null)).toBe(true)
      expect(lobby.pickedHeroes.size).toBe(9)
      // Registered so /api/queue/status + ws reconnect can recover it.
      expect(getPlayerLobby('u_final')).toBe(lobby.id)
      expect(getLobby(lobby.id)).toBe(lobby)
      // currentPickTurn points at the human (so pick_turn re-send works).
      const turn = currentPickTurn(lobby)
      expect(turn?.playerId).toBe('u_final')
    } finally {
      cleanupLobby(lobby.id)
    }
  })

  it('prepick 5: human is mid-draft with 5 heroes already picked', () => {
    const lobby = seedDraftLobby({ humanId: 'u_mid', humanUsername: 'u_mid', prepick: 5 })
    try {
      expect(lobby.currentPickIndex).toBe(5)
      expect(lobby.pickedHeroes.size).toBe(5)
      const human = lobby.players.find((p) => p.playerId === 'u_mid')!
      expect(human.heroId).toBeNull()
      // It is genuinely the human's turn at this index.
      const turnIdx = lobby.pickOrder[lobby.currentPickIndex]!
      expect(lobby.players[turnIdx]!.playerId).toBe('u_mid')
    } finally {
      cleanupLobby(lobby.id)
    }
  })

  it('clamps prepick into 0..9', () => {
    const lo = seedDraftLobby({ humanId: 'u_lo', humanUsername: 'u_lo', prepick: -3 })
    const hi = seedDraftLobby({ humanId: 'u_hi', humanUsername: 'u_hi', prepick: 42 })
    try {
      expect(lo.currentPickIndex).toBe(0)
      expect(hi.currentPickIndex).toBe(9)
    } finally {
      cleanupLobby(lo.id)
      cleanupLobby(hi.id)
    }
  })
})
