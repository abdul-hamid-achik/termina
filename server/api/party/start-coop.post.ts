import { claimPartyForStart, restoreParty, type Party } from '~~/server/game/matchmaking/party'
import { createBotPlayers, difficultyForMmr } from '~~/server/game/ai/BotManager'
import { findLiveGameForPlayer, startLiveGame } from '~~/server/game/liveGame'
import { matchLog } from '~~/server/utils/log'
import { isPlayerInQueue } from '~~/server/game/matchmaking/queueNeon'
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

  // Atomic claim: the party is DELETED inside the parties advisory lock and the
  // member snapshot it returns is the roster we start from. A double-click or a
  // second tab finds no party (409); a member joining before the claim is in
  // the snapshot, one joining after simply finds no party — nobody is dropped
  // between "read roster" and "disband".
  const claim = await claimPartyForStart(playerId)
  if (!claim.ok) {
    if (claim.reason === 'not_leader') {
      throw createError({ statusCode: 403, message: 'Only the party leader can start the game' })
    }
    throw createError({
      statusCode: 409,
      message: 'No party to start — it may already have started or been disbanded',
    })
  }
  const party = claim.party

  // The party is gone from the DB from here on; ANY failure below must put it
  // back so the leader can retry (a restore failure is logged, never masks the
  // original cause).
  try {
    return await startCoopFor(playerId, party)
  } catch (err) {
    try {
      await restoreParty(party)
    } catch (restoreErr) {
      matchLog.error('Failed to restore party after a failed co-op start', {
        code: party.code,
        restoreErr,
      })
    }
    throw err
  }
})

async function startCoopFor(playerId: string, party: Party) {
  // Same guards as /api/queue/join-neon, applied to EVERY party member (not
  // just the leader): nobody may be sitting in the matchmaking queue (their
  // row could be pulled into a quick-match at the same moment) or already be
  // in a live game (they'd be in two games at once).
  for (const m of party.members) {
    const self = m.playerId === playerId
    if (await findLiveGameForPlayer(m.playerId)) {
      throw createError({
        statusCode: 409,
        message: self ? 'Already in an active game' : `${m.username} is already in an active game`,
      })
    }
    if (await isPlayerInQueue(m.playerId)) {
      throw createError({
        statusCode: 409,
        message: self ? 'Already in queue' : `${m.username} is already in the queue`,
      })
    }
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

  const started = await startLiveGame(players, {
    mode: 'normal',
    // Bots scale to the party's average MMR (same rule as quick-match).
    botOptions: { difficulty: difficultyForMmr(avgMmr) },
  })
  return { success: true, gameId: started.gameId }
}
