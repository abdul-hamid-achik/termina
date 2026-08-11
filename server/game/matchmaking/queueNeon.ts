import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { queueEntries, type QueueEntryRow } from '~~/server/db/schema'
import { isGuestId } from '~~/server/utils/guest'
import { createBotPlayers } from '~~/server/game/ai/BotManager'
import { matchLog } from '~~/server/utils/log'

/**
 * Neon-backed matchmaking queue — the all-Vercel replacement for the Redis
 * sorted-set queue that used to live at server/game/matchmaking/queue.ts,
 * deleted with the rest of the DO/Redis era once this cutover completed.
 *
 * Key differences from the deleted Redis version:
 *  - There is no background interval sweep (`startMatchmakingLoop`) on
 *    Vercel — nothing keeps a process warm to run one. Match formation is
 *    EVENT-DRIVEN instead: `tryFormMatchNeon` runs inline at the end of
 *    `joinQueue`, and opportunistically again from `checkQueueStatusNeon`
 *    (a status poll) so a lone waiting player's bot-fill timer still gets
 *    re-checked even if nobody else joins. A Workflow-based periodic sweep
 *    can replace/augment this callsite-driven check later without touching
 *    the matching algorithm itself — see the TODO at the bottom of this file.
 *  - Mutual exclusion uses a Postgres advisory transaction lock
 *    (`pg_advisory_xact_lock(hashtext(mode))`) instead of a Redis SETNX +
 *    manual release. It's scoped to the enclosing transaction, so a crash or
 *    a thrown error releases it automatically — no compare-and-delete needed.
 *  - `queue_entries.player_id` is the PRIMARY KEY, so "already queued" (in
 *    this mode OR another) falls out of a Postgres unique-violation on
 *    insert, rather than a separate mode-agnostic sentinel key.
 *
 * Match sizing, MMR-range widening, and the bot-backfill threshold
 * (MATCH_SIZE_BY_MODE / MMR_RANGES / BOT_FILL_WAIT_MS below) are literal
 * copies of the deleted queue.ts's same constants, not a coincidence.
 */

export type QueueMode = 'ranked_5v5' | 'quick_3v3' | '1v1'

export interface QueueJoinInput {
  playerId: string
  username: string
  mmr: number
  mode: QueueMode
}

/** One player (real or bot) placed into a formed match, pre-team-assignment. */
export interface MatchRosterEntry {
  playerId: string
  username: string
  mmr: number
  mode: QueueMode
}

export interface FormedMatch {
  mode: QueueMode
  /** Real players pulled off the queue table for this match. */
  players: MatchRosterEntry[]
  /** Synthetic bot fills — non-empty only when this match formed via backfill. */
  bots: MatchRosterEntry[]
  /** players + bots in one list (mmr-sorted for real players, bots appended last). */
  roster: MatchRosterEntry[]
}

export type JoinQueueResult =
  | { matched: true; match: FormedMatch }
  | { matched: false; queueSize: number }

export type QueueStatus =
  | { status: 'idle' }
  | { status: 'searching'; queueSize: number }
  | { status: 'matched'; match: FormedMatch }

export const GUEST_QUEUE_REJECTION_MESSAGE =
  'Sign in to queue for a match — guest sessions can only play practice vs bots'

/** Mirrors queue.ts's MATCH_SIZE_BY_MODE. */
const MATCH_SIZE_BY_MODE: Record<QueueMode, number> = {
  ranked_5v5: 10,
  quick_3v3: 6,
  '1v1': 2,
}

/** Mirrors queue.ts's BOT_FILL_WAIT_MS. */
const BOT_FILL_WAIT_MS = 10_000

/** Mirrors queue.ts's MMR_RANGES. */
const MMR_RANGES: { afterSeconds: number; range: number }[] = [
  { afterSeconds: 0, range: 50 },
  { afterSeconds: 30, range: 100 },
  { afterSeconds: 60, range: 200 },
  { afterSeconds: 120, range: 500 },
]

function getMmrRange(waitTimeSeconds: number): number {
  let range = MMR_RANGES[0]!.range
  for (const entry of MMR_RANGES) {
    if (waitTimeSeconds >= entry.afterSeconds) {
      range = entry.range
    }
  }
  return range
}

function toRosterEntry(mode: QueueMode) {
  return (row: QueueEntryRow): MatchRosterEntry => ({
    playerId: row.playerId,
    username: row.username,
    mmr: row.mmr,
    mode,
  })
}

/** Postgres unique_violation (23505) on the player_id PK — already queued. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/**
 * Join the Neon-backed queue. Rejects guests exactly like the current
 * DO-era join API (server/api/queue/join.post.ts's isGuestId check) — a
 * guest has no `players` row for MMR/match history to persist against.
 *
 * Event-driven: immediately tries to form a match for `input.mode` after
 * inserting. If a match forms (this join completed a roster, or tipped a
 * mode into bot-backfill), the formed roster is returned directly — there
 * is no poll loop to pick it up later.
 */
export async function joinQueue(input: QueueJoinInput): Promise<JoinQueueResult> {
  if (isGuestId(input.playerId)) {
    throw new Error(GUEST_QUEUE_REJECTION_MESSAGE)
  }

  const db = useDb()
  try {
    await db.insert(queueEntries).values({
      playerId: input.playerId,
      username: input.username,
      mmr: input.mmr,
      mode: input.mode,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error('already in queue')
    }
    throw err
  }

  matchLog.info('Player joined queue (neon)', {
    playerId: input.playerId,
    mmr: input.mmr,
    mode: input.mode,
  })

  const match = await tryFormMatchNeon(input.mode)
  if (match) return { matched: true, match }

  return { matched: false, queueSize: await queueSize(input.mode) }
}

/** Remove a player's queue entry, if any (idempotent — no-op if absent). */
export async function leaveQueue(playerId: string): Promise<void> {
  const db = useDb()
  await db.delete(queueEntries).where(eq(queueEntries.playerId, playerId))
  matchLog.info('Player left queue (neon)', { playerId })
}

/** Count of players currently queued for `mode` (defaults to ranked_5v5, mirroring queue.ts). */
export async function queueSize(mode: QueueMode = 'ranked_5v5'): Promise<number> {
  const db = useDb()
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(queueEntries)
    .where(eq(queueEntries.mode, mode))
  return Number(rows[0]?.count ?? 0)
}

/**
 * Whether `playerId` currently has a queue entry. Since `player_id` is the
 * table's PRIMARY KEY, a player can hold at most one row across all modes —
 * unlike the Redis version there is no separate per-mode key to fan out over.
 * Passing `mode` disambiguates "queued, but not for this mode" from "queued".
 */
export async function isPlayerInQueue(playerId: string, mode?: QueueMode): Promise<boolean> {
  const db = useDb()
  const condition = mode
    ? and(eq(queueEntries.playerId, playerId), eq(queueEntries.mode, mode))
    : eq(queueEntries.playerId, playerId)
  const rows = await db
    .select({ playerId: queueEntries.playerId })
    .from(queueEntries)
    .where(condition)
    .limit(1)
  return rows.length > 0
}

/**
 * Try to form a match for `mode` right now. Safe to call anytime — most
 * calls will find an incomplete, not-yet-backfill-eligible roster and return
 * null having done nothing. Runs inside a transaction holding a Postgres
 * advisory lock scoped to `mode` (`pg_advisory_xact_lock(hashtext(mode))`),
 * so two concurrent callers for the SAME mode serialize (the second sees the
 * first's committed deletes/inserts); different modes never block each other.
 *
 * On success, the matched players' (and only the matched players') rows are
 * deleted from queue_entries within the same transaction — atomic with the
 * roster this function returns, so a crash between "formed" and "acted on"
 * can't happen (there is nothing to act on except the return value itself).
 */
export async function tryFormMatchNeon(mode: QueueMode): Promise<FormedMatch | null> {
  const db = useDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${mode}))`)

    const rows = await tx
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.mode, mode))
      .orderBy(asc(queueEntries.mmr))

    if (rows.length === 0) return null

    const matchSize = MATCH_SIZE_BY_MODE[mode]
    const now = Date.now()

    if (rows.length < matchSize) {
      // ── Bot backfill ──────────────────────────────────────────────
      // Same threshold as queue.ts: once the longest-waiting player has
      // been in line >= BOT_FILL_WAIT_MS, fill the rest with bots. There is
      // no interval sweep here, so this only fires when SOMETHING calls
      // tryFormMatchNeon again for this mode (another join, or a status
      // poll via checkQueueStatusNeon) after the threshold has elapsed.
      const longestWaitMs = now - Math.min(...rows.map((r) => r.joinedAt.getTime()))
      if (longestWaitMs < BOT_FILL_WAIT_MS) return null

      const botsNeeded = matchSize - rows.length
      const avgMmr = Math.round(rows.reduce((sum, r) => sum + r.mmr, 0) / rows.length)
      const botEntries = createBotPlayers(
        botsNeeded,
        rows.map((r) => r.playerId),
        avgMmr,
      )

      await tx.delete(queueEntries).where(eq(queueEntries.mode, mode))

      const players = rows.map(toRosterEntry(mode))
      const bots: MatchRosterEntry[] = botEntries.map((b) => ({
        playerId: b.playerId,
        username: b.username,
        mmr: b.mmr,
        mode,
      }))
      matchLog.info('Match formed with bots (neon)', {
        realPlayers: players.length,
        bots: bots.length,
        mode,
      })
      return { mode, players, bots, roster: [...players, ...bots] }
    }

    // ── Full roster, MMR-range widening ────────────────────────────
    for (let i = 0; i <= rows.length - matchSize; i++) {
      const group = rows.slice(i, i + matchSize)
      const minMmr = group[0]!.mmr
      const maxMmr = group[group.length - 1]!.mmr
      const allWithinRange = group.every((r) => {
        const waitSeconds = (now - r.joinedAt.getTime()) / 1000
        const allowedRange = getMmrRange(waitSeconds)
        return maxMmr - minMmr <= allowedRange * 2
      })
      if (!allWithinRange) continue

      const ids = group.map((r) => r.playerId)
      await tx.delete(queueEntries).where(inArray(queueEntries.playerId, ids))
      const players = group.map(toRosterEntry(mode))
      matchLog.info('Match formed (neon)', { queueSize: rows.length, matchSize, mode })
      return { mode, players, bots: [], roster: players }
    }

    return null
  })
}

/**
 * Status check for a queued (or just-matched) player. Besides reporting
 * current state, this is the OTHER place (alongside joinQueue) that
 * opportunistically re-runs tryFormMatchNeon — see the module doc comment.
 * A polling client therefore still gets bot-backfilled even if it is the
 * only one left waiting and nobody else ever joins that mode again.
 */
export async function checkQueueStatusNeon(playerId: string): Promise<QueueStatus> {
  const db = useDb()
  const [row] = await db
    .select()
    .from(queueEntries)
    .where(eq(queueEntries.playerId, playerId))
    .limit(1)
  if (!row) return { status: 'idle' }

  const mode = row.mode as QueueMode
  const match = await tryFormMatchNeon(mode)
  if (match && match.roster.some((p) => p.playerId === playerId)) {
    return { status: 'matched', match }
  }

  return { status: 'searching', queueSize: await queueSize(mode) }
}

// ── Game start hookup (DONE) ─────────────────────────────────────────
// tryFormMatchNeon/joinQueue return a FormedMatch (roster + mode) only —
// starting the actual live game is server/game/matchmaking/matchStart.ts's
// job (startFormedMatch → server/game/liveGame.ts's startLiveGame, which
// seeds the live_games row and kicks off the game's first Workflow tick),
// called from both /api/queue/join-neon and /api/queue/status-neon wherever
// they see `{ matched: true, match }`.
//
// Hero picks/bans (the old WS-lobby draft, server/game/matchmaking/lobby.ts)
// were NOT ported — a formed match goes straight from queue to a running
// game with round-robin hero assignment and no pick screen. A Neon-backed
// draft is a real follow-up feature, not a cutover blocker.
