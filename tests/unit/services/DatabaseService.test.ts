import { describe, it, vi } from 'vitest'

vi.mock('../../../server/db', () => ({
  useDb: vi.fn(),
}))

vi.mock('../../../server/db/schema', () => ({
  players: {
    id: 'id',
    provider: 'provider',
    providerId: 'providerId',
    mmr: 'mmr',
  },
  matches: { id: 'id' },
  matchPlayers: { matchId: 'matchId', playerId: 'playerId' },
  heroStats: { playerId: 'playerId', heroId: 'heroId' },
  playerProviders: { playerId: 'playerId', provider: 'provider' },
}))

describe('DatabaseService', () => {
  describe('getPlayer', () => {
    it.todo('should return player by id')
    it.todo('should return null for non-existent player')
  })

  describe('getPlayerByProvider', () => {
    it.todo('should find player by provider and providerId')
    it.todo('should return null for non-existent provider')
  })

  describe('createPlayer', () => {
    it.todo('should create a new player')
    it.todo('should return created player with id')
  })

  describe('updatePlayerMMR', () => {
    it.todo('should update player MMR')
    it.todo('should log MMR update')
  })

  describe('recordMatch', () => {
    it.todo('should record a match with players')
    it.todo('should return match id')
    it.todo('should log match creation')
  })

  describe('getMatchHistory', () => {
    it.todo('should return match history for player')
    it.todo('should limit results')
    it.todo('should return empty array for player with no matches')
  })

  describe('getMatch', () => {
    it.todo('should return match with players')
    it.todo('should return null for non-existent match')
  })

  describe('getLeaderboard', () => {
    it.todo('should return top players by MMR')
    it.todo('should limit results')
  })

  describe('updateHeroStats', () => {
    it.todo('should create new hero stats entry')
    it.todo('should update existing hero stats')
    it.todo('should increment games played')
    it.todo('should increment wins when won')
  })

  describe('getHeroStats', () => {
    it.todo('should return hero stats for player')
    it.todo('should return empty array for player with no stats')
  })

  describe('incrementGamesPlayed', () => {
    it.todo('should increment games played counter')
  })

  describe('incrementWins', () => {
    it.todo('should increment wins counter')
  })

  describe('getPlayerByUsername', () => {
    it.todo('should find player by username')
    it.todo('should return null for non-existent username')
  })

  describe('createLocalPlayer', () => {
    it.todo('should create local player with hashed password')
    it.todo('should generate local_ prefixed id')
  })

  describe('linkProvider', () => {
    it.todo('should link provider to player')
  })

  describe('unlinkProvider', () => {
    it.todo('should unlink provider from player')
  })

  describe('getPlayerProviders', () => {
    it.todo('should return all providers for player')
  })

  describe('updatePlayerAvatar', () => {
    it.todo('should update selected avatar')
  })

  describe('updatePlayerUsername', () => {
    it.todo('should update username')
  })

  describe('updatePlayerPassword', () => {
    it.todo('should update password hash')
  })
})
