import { HERO_IDS } from '~~/shared/constants/heroes'
import { mapIdForMode } from '~~/shared/constants/maps'
import { startLiveGame, type StartLiveGameResult } from '~~/server/game/liveGame'
import type { FormedMatch, MatchRosterEntry } from '~~/server/game/matchmaking/queueNeon'
import type { LiveGameRosterPlayer } from '~~/server/db/schema'

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
 * Start the live game for a match tryFormMatchNeon just formed. Shared by
 * both /api/queue/join-neon (a join that completes a roster) and
 * /api/queue/status-neon (the opportunistic bot-fill re-check on a status
 * poll) — either one can be the call that tips a match into existence.
 */
export async function startFormedMatch(match: FormedMatch): Promise<StartLiveGameResult> {
  const players = assignQuickMatchRoster(match.roster)
  return startLiveGame(players, {
    mode: 'normal',
    mapId: mapIdForMode(match.mode),
    gameIdPrefix: 'q',
  })
}
