import { Effect } from 'effect'
import { getGameRuntime } from '../../plugins/game-server'
import { listSnapshotGameIds, readSnapshot } from '../../game/engine/StateSnapshot'
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
    radiantKills: number
    direKills: number
    radiantHeroes: string[]
    direHeroes: string[]
  }> = []

  for (const gameId of ids) {
    const snap = await Effect.runPromise(readSnapshot(runtime.redisService, gameId))
    if (!snap) continue
    if (snap.state.phase !== 'playing') continue

    const radiantHeroes: string[] = []
    const direHeroes: string[] = []
    for (const p of Object.values(snap.state.players)) {
      const heroName = p.heroId ? (HEROES[p.heroId]?.name ?? p.heroId) : '???'
      if (p.team === 'radiant') radiantHeroes.push(heroName)
      else direHeroes.push(heroName)
    }

    games.push({
      gameId,
      tick: snap.state.tick,
      radiantKills: snap.state.teams.radiant.kills,
      direKills: snap.state.teams.dire.kills,
      radiantHeroes,
      direHeroes,
    })
  }

  // Newest first (longer-running games last)
  games.sort((a, b) => a.tick - b.tick)

  return { games }
})
