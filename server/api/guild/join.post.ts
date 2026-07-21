import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }
  const playerId = session.user.id as string

  const body = await readBody(event)
  const name = ((body?.name ?? '') as string).trim()
  if (!name) {
    throw createError({ statusCode: 400, message: 'Missing guild name' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const guild = await Effect.runPromise(runtime.dbService.getGuildByName(name))
  if (!guild) {
    throw createError({ statusCode: 404, message: 'Guild not found' })
  }

  await Effect.runPromise(runtime.dbService.joinGuild(guild.id, playerId))
  return { guild }
})
