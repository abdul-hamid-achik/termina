import { Effect } from 'effect'
import { getGameRuntime } from '~~/server/plugins/game-server'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const runtime = getGameRuntime()
  if (!runtime) {
    throw createError({ statusCode: 503, message: 'Game server not ready' })
  }

  const guild = await Effect.runPromise(runtime.dbService.getPlayerGuild(session.user.id as string))
  if (!guild) {
    return { guild: null, members: [] }
  }

  const members = await Effect.runPromise(runtime.dbService.getGuildMembers(guild.id))
  return {
    guild,
    members: members.map((m) => ({
      id: m.id,
      username: m.username,
      avatarUrl: m.avatarUrl,
      seasonMmr: m.seasonMmr,
      isLeader: m.id === guild.leaderId,
    })),
  }
})
