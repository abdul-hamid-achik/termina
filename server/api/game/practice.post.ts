import { parseBotDifficulty } from '~~/server/game/ai/BotManager'
import { buildTutorialRoster } from '~~/server/game/modes/tutorial'
import { startLiveGame } from '~~/server/game/liveGame'
import { checkScopedRateLimit } from '~~/server/utils/RateLimiter'
import { HEROES } from '~~/shared/constants/heroes'
import type { LiveGameRosterPlayer } from '~~/server/db/schema'

/**
 * All-Vercel replacement for /api/game/tutorial: starts the same guided
 * one-lane practice-vs-bots game (buildTutorialRoster, mode 'tutorial',
 * mapId 'one_lane'), but via the Neon+Workflow live-game path
 * (server/game/liveGame.ts's startLiveGame) instead of the DO-era in-
 * process game server (server/plugins/game-server.ts's createTutorialGame).
 * Session-authenticated INCLUDING guests — practice vs bots is the one mode
 * a guest session (server/api/auth/guest.post.ts) can play, same as the
 * tutorial endpoint.
 *
 * Body: { heroSelf?, difficulty? } → { gameId }
 *
 * NOT ported from tutorial.post.ts: the "replace a stranded previous
 * practice game" dance (getPlayerGame/stopDevGame). That logic is keyed off
 * PeerRegistry, a DO-era in-process map with no equivalent here — a player
 * who abandons a practice game on this path just leaves an idle live_games
 * row for the reaper/finalize path to clean up once it ticks to 'ended' or
 * goes stale. Follow-up if that turns out to matter before cutover.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const humanId = session?.user?.id as string | undefined
  if (!humanId) {
    throw createError({ statusCode: 401, message: 'Sign in to start the tutorial' })
  }

  if (!checkScopedRateLimit('tutorial', humanId)) {
    throw createError({ statusCode: 429, message: 'Too many tutorial requests — slow down' })
  }

  const body = await readBody<{ heroSelf?: string; difficulty?: string }>(event).catch(
    () => ({}) as { heroSelf?: string; difficulty?: string },
  )
  const humanHero =
    body?.heroSelf && HEROES[body.heroSelf] ? body.heroSelf : Object.keys(HEROES)[0]!
  const difficulty = parseBotDifficulty(body?.difficulty) ?? 'easy'

  const gameId = `prac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const players: LiveGameRosterPlayer[] = buildTutorialRoster(humanId, humanHero, gameId).map(
    (p) => ({ ...p, mmr: 1000 }),
  )

  const started = await startLiveGame(players, {
    gameId,
    mode: 'tutorial',
    mapId: 'one_lane',
    botOptions: {
      difficulty,
      // The one-lane map has no top/bot/jungle lanes — pin bots to mid
      // (coldstore), mirroring _createDevGame's tutorial/one_lane handling.
      forceLane: 'coldstore',
    },
  })

  return { gameId: started.gameId }
})
