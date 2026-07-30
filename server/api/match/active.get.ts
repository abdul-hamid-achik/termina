import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'
import { listSnapshotGameIds, readSnapshot } from '~~/server/game/engine/StateSnapshot'
import { HEROES } from '~~/shared/constants/heroes'

/**
 * List currently-in-progress games. Matches are only written to the DB on
 * game-over, so the source of truth for "live" games is the snapshot index
 * in Redis. Each entry is enough to build a spectate link.
 */
export default defineEventHandler(async () => {
  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const ids = await Effect.runPromise(listSnapshotGameIds(runtime.redisService))

  const games: Array<{
    gameId: string
    tick: number
    chaffKills: number
    auditKills: number
    chaffHeroes: string[]
    auditHeroes: string[]
  }> = []

  for (const gameId of ids) {
    const snap = await Effect.runPromise(readSnapshot(runtime.redisService, gameId))
    if (!snap) continue
    if (snap.state.phase !== 'playing') continue

    const chaffHeroes: string[] = []
    const auditHeroes: string[] = []
    for (const p of Object.values(snap.state.players)) {
      const heroName = p.heroId ? (HEROES[p.heroId]?.name ?? p.heroId) : '???'
      if (p.team === 'chaff') chaffHeroes.push(heroName)
      else auditHeroes.push(heroName)
    }

    games.push({
      gameId,
      tick: snap.state.tick,
      chaffKills: snap.state.teams.chaff.kills,
      auditKills: snap.state.teams.audit.kills,
      chaffHeroes,
      auditHeroes,
    })
  }

  // Newest first (longer-running games last)
  games.sort((a, b) => a.tick - b.tick)

  return { games }
})
