import { eq } from 'drizzle-orm'
import { HERO_IDS } from '~~/shared/constants/heroes'
import { mapIdForMode } from '~~/shared/constants/maps'
import {
  startLiveGame,
  type StartLiveGameOpts,
  type StartLiveGameResult,
} from '~~/server/game/liveGame'
import { difficultyForMmr } from '~~/server/game/ai/BotManager'
import { requeueMatchPlayers } from '~~/server/game/matchmaking/queueNeon'
import type { FormedMatch, MatchRosterEntry } from '~~/server/game/matchmaking/queueNeon'
import { useDb } from '~~/server/db'
import { liveGames, type LiveGameRosterPlayer } from '~~/server/db/schema'
import { matchLog } from '~~/server/utils/log'

/**
 * Turn a queueNeon.FormedMatch (playerId/username/mmr — no team, no hero)
 * into a startable live-game roster.
 *
 * PRE-LAUNCH SIMPLIFICATION: the 5v5 draft/ban flow (server/game/
 * matchmaking/lobby.ts's snake pick order + ban phase) is NOT ported to the
 * Neon/Ably path — see queueNeon.ts's integration TODO and the task that
 * introduced this module. A formed match goes straight from queue to a
 * running game with no pick screen:
 *
 *  - TEAMS: alternate by index parity over the match's roster (which
 *    tryFormMatchNeon already returns MMR-sorted for real players, bots
 *    appended last) — even index → chaff, odd → audit. This is a cheap
 *    snake-style balance: adjacent-mmr players land on opposite sides
 *    instead of the whole top half of the bracket facing the whole bottom
 *    half. Good enough pre-launch; a real seed/balance pass is follow-up.
 *  - HEROES: round-robin through HERO_IDS in roster order so every player
 *    gets a distinct hero with zero pick UI, mirroring the same "used-set +
 *    nextHero()" pattern game-server.ts's _createDevGame and buildTutorial
 *    Roster already use for bot/practice rosters.
 */
export function assignQuickMatchRoster(roster: MatchRosterEntry[]): LiveGameRosterPlayer[] {
  const usedHeroes = new Set<string>()
  const nextHero = (): string => {
    const h = HERO_IDS.find((id) => !usedHeroes.has(id)) ?? HERO_IDS[0]!
    usedHeroes.add(h)
    return h
  }
  return roster.map((entry, i) => ({
    playerId: entry.playerId,
    team: i % 2 === 0 ? 'chaff' : 'audit',
    heroId: nextHero(),
    mmr: entry.mmr,
  }))
}

/**
 * Bot difficulty scales with the HUMAN players' average MMR (bots carry a
 * synthetic MMR copied from that average, so only real players are counted).
 * A match with no bots registers none, so it gets no botOptions at all.
 */
function botOptionsForMatch(match: FormedMatch): Pick<StartLiveGameOpts, 'botOptions'> {
  if (match.bots.length === 0 || match.players.length === 0) return {}
  const avgMmr = match.players.reduce((sum, p) => sum + p.mmr, 0) / match.players.length
  return { botOptions: { difficulty: difficultyForMmr(avgMmr) } }
}

/**
 * Start the live game for a match tryFormMatchNeon just formed. Shared by
 * both /api/queue/join-neon (a join that completes a roster) and
 * /api/queue/status-neon (the opportunistic bot-fill re-check on a status
 * poll) — either one can be the call that tips a match into existence.
 *
 * tryFormMatchNeon has ALREADY deleted the matched players' queue rows by the
 * time this runs (separate transaction, game doesn't exist yet). If starting
 * the game throws, those players would otherwise vanish with no game and no
 * queue entry. So on failure: drop any half-created live_games row (it would
 * make status-neon report a dead game as 'found'), put the real players back
 * in the queue with their original wait, and rethrow the ORIGINAL error so
 * the caller can surface it.
 */
export async function startFormedMatch(match: FormedMatch): Promise<StartLiveGameResult> {
  const players = assignQuickMatchRoster(match.roster)
  const gameId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  try {
    return await startLiveGame(players, {
      gameId,
      mode: 'normal',
      mapId: mapIdForMode(match.mode),
      ...botOptionsForMatch(match),
    })
  } catch (err) {
    matchLog.error('Live game start failed for a formed match — requeueing players', {
      gameId,
      mode: match.mode,
      error: err instanceof Error ? err.message : String(err),
    })
    try {
      await useDb().delete(liveGames).where(eq(liveGames.gameId, gameId))
    } catch (cleanupErr) {
      matchLog.error('Failed to remove orphaned live_games row', { gameId, cleanupErr })
    }
    try {
      await requeueMatchPlayers(match)
    } catch (requeueErr) {
      matchLog.error('Failed to requeue players after a failed match start', {
        gameId,
        requeueErr,
      })
    }
    throw err
  }
}
