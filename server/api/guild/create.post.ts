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
  const tag = ((body?.tag ?? '') as string).trim().toUpperCase()

  if (name.length < 3 || name.length > 24) {
    throw createError({ statusCode: 400, message: 'Guild name must be 3-24 characters' })
  }
  if (tag.length < 2 || tag.length > 5) {
    throw createError({ statusCode: 400, message: 'Guild tag must be 2-5 characters' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  // One guild per player — leave any current guild first.
  await Effect.runPromise(runtime.dbService.leaveGuild(playerId))

  // Reject a duplicate name with a friendly error (the unique constraint would
  // otherwise surface as a 500).
  const existing = await Effect.runPromise(runtime.dbService.getGuildByName(name))
  if (existing) {
    throw createError({ statusCode: 409, message: 'That guild name is taken' })
  }

  const guild = await Effect.runPromise(runtime.dbService.createGuild(name, tag, playerId))
  return { guild }
})
