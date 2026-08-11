import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from '~~/server/db'
import { players } from '~~/server/db/schema'
import { isGuestId } from '~~/server/utils/guest'

/**
 * Session-based admin gate for the operator panel (/admin + /api/admin/*
 * except rotate-season, which keeps its own shared-secret header gate for
 * curl/CI use).
 *
 * Identity comes from env allow-lists — if NEITHER is set the gate is
 * closed (403), never accidentally open, same convention as
 * TERMINA_ADMIN_KEY:
 *  - TERMINA_ADMIN_PLAYER_IDS: comma-separated player ids (e.g. github_123)
 *  - TERMINA_ADMIN_EMAILS: comma-separated emails, matched case-insensitively
 *    against players.email (the session doesn't carry email, so this is a DB
 *    lookup — cheap, and only performed when the email list is configured)
 */

/** Pure allow-list check — see requireAdmin for the env semantics. */
export function isAdminIdentity(
  playerId: string,
  email: string | null,
  allowIdsCsv: string,
  allowEmailsCsv: string,
): boolean {
  const ids = allowIdsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const emails = allowEmailsCsv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (ids.includes(playerId)) return true
  return email !== null && emails.includes(email.toLowerCase())
}

/** Throws 401 (no session) or 403 (not an admin); returns the admin's playerId. */
export async function requireAdmin(event: H3Event): Promise<string> {
  const session = await getUserSession(event)
  const playerId = session?.user?.id as string | undefined
  if (!playerId) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const allowIds = process.env.TERMINA_ADMIN_PLAYER_IDS ?? ''
  const allowEmails = process.env.TERMINA_ADMIN_EMAILS ?? ''
  if (!allowIds.trim() && !allowEmails.trim()) {
    throw createError({ statusCode: 403, message: 'Admin panel not configured' })
  }
  // Guests have no players row (and no business here).
  if (isGuestId(playerId)) {
    throw createError({ statusCode: 403, message: 'Admin access denied' })
  }

  let email: string | null = null
  if (allowEmails.trim()) {
    const [row] = await useDb()
      .select({ email: players.email })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1)
    email = row?.email ?? null
  }

  if (!isAdminIdentity(playerId, email, allowIds, allowEmails)) {
    throw createError({ statusCode: 403, message: 'Admin access denied' })
  }
  return playerId
}
