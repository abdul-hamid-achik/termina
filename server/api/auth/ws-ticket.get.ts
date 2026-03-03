import { createWsTicket } from '~~/server/utils/ws-ticket'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const secret = useRuntimeConfig().session?.password
  if (!secret) {
    throw createError({ statusCode: 500, message: 'Server misconfigured' })
  }

  const ticket = createWsTicket(session.user.id as string, secret)
  return { ticket }
})
