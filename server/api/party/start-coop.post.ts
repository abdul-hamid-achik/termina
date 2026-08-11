import { getPartyByPlayer, disbandParty } from '~~/server/game/matchmaking/party'
import { createBotPlayers } from '~~/server/game/ai/BotManager'
import { startLiveGame } from '~~/server/game/liveGame'
import { HERO_IDS } from '~~/shared/constants/heroes'
import type { LiveGameRosterPlayer } from '~~/server/db/schema'

/**
 * All-Vercel replacement for the DO-era WS lobby's co-op path
 * (server/game/matchmaking/lobby.ts's createCoopLobby, deleted with the WS
 * game server): the party (chaff) plus bots filling out both teams to a
 * 5v5, straight into a running game via server/game/liveGame.ts's
 * startLiveGame — no pick screen, mirroring the same
 * "no draft on the Neon path" simplification as
 * server/game/matchmaking/matchStart.ts's assignQuickMatchRoster (round-robin
 * heroes, zero pick UI).
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }
  const playerId = session.user.id as string

  const party = getPartyByPlayer(playerId)
  if (!party) {
    throw createError({ statusCode: 400, message: 'You are not in a party' })
  }
  if (party.leaderId !== playerId) {
    throw createError({ statusCode: 403, message: 'Only the party leader can start the game' })
  }

  const avgMmr = Math.round(party.members.reduce((sum, m) => sum + m.mmr, 0) / party.members.length)
  // Party fills chaff up to 5; bots fill the rest of chaff + all of audit —
  // the same split createCoopLobby used.
  const chaffBotsNeeded = Math.max(0, 5 - party.members.length)
  const auditBotsNeeded = 5
  const bots = createBotPlayers(
    chaffBotsNeeded + auditBotsNeeded,
    party.members.map((m) => m.playerId),
    avgMmr,
  )

  const usedHeroes = new Set<string>()
  const nextHero = (): string => {
    const h = HERO_IDS.find((id) => !usedHeroes.has(id)) ?? HERO_IDS[0]!
    usedHeroes.add(h)
    return h
  }

  const players: LiveGameRosterPlayer[] = [
    ...party.members.map((m) => ({
      playerId: m.playerId,
      team: 'chaff' as const,
      heroId: nextHero(),
      mmr: m.mmr,
    })),
    ...bots.map((b, i) => ({
      playerId: b.playerId,
      team: i < chaffBotsNeeded ? ('chaff' as const) : ('audit' as const),
      heroId: nextHero(),
      mmr: b.mmr,
    })),
  ]

  const started = await startLiveGame(players, { mode: 'normal' })
  // The party is disbanded once the game exists — its members are now in a
  // live game, not waiting in a party.
  disbandParty(party.code)

  return { success: true, gameId: started.gameId }
})
