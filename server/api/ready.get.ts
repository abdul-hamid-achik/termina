import { sql } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { logger } from '~~/server/utils/log'

/**
 * Readiness probe.
 *
 * The DB is `drizzle-kit push`-managed with no migration history, which means
 * "ship the code" and "apply the schema" are two separate manual steps. Twice
 * now (Aug 1: login broken, Aug 10: /api/match/history 500) a deploy shipped
 * ahead of `bun run db:push` against prod Neon and served 500s to players
 * instead of failing readiness. See REQUIRED_COLUMNS below.
 *
 * The old runtime gate (getGameRuntime — "has the DO-era in-process game
 * server's Redis/DB/WebSocket bring-up finished") is gone with that plugin's
 * rework: on Vercel, a serverless function's Nitro plugins finish resolving
 * before the function ever serves a request, so there is no long-lived
 * "starting" window left to gate on — the schema contract is the only
 * readiness signal that still means something here.
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'content-type', 'application/json')

  const schema = await checkSchemaContract()

  if (!schema.ok) {
    setResponseStatus(event, 503)
    return {
      status: schema.errored ? 'schema_check_failed' : 'schema_drift',
      schema: schema.errored ? 'unknown' : 'drift',
      ...(schema.errored ? {} : { missingColumns: schema.missing }),
      timestamp: Date.now(),
    }
  }

  setResponseStatus(event, 200)
  return { status: 'ready', schema: 'ready', timestamp: Date.now() }
})

/**
 * Sentinel (table, column) pairs the running code currently depends on,
 * biased toward the NEWEST additions — those are the ones drift actually
 * bites, since anything old enough to be in prod already survived its own
 * `db:push`.
 *
 * This is deliberately NOT an exhaustive mirror of server/db/schema.ts — keep
 * it small. When you add a column the running code depends on, add ONE
 * sentinel entry here (not the whole table) so a deploy against a drifted
 * database fails readiness instead of 500ing on real player traffic.
 */
export const REQUIRED_COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string }> =
  [
    { table: 'matches', column: 'derived_stats_applied' },
    { table: 'matches', column: 'season_number' },
    { table: 'match_players', column: 'final_scrip' },
    { table: 'match_players', column: 'net_worth' },
    { table: 'match_players', column: 'ice_damage_dealt' },
    { table: 'match_players', column: 'last_hits' },
    { table: 'match_players', column: 'burns' },
    { table: 'players', column: 'season_mmr' },
    { table: 'players', column: 'tutorial_completed' },
    { table: 'match_replays', column: 'rng_seed' },
    { table: 'live_games', column: 'roster' },
    { table: 'pending_actions', column: 'for_cycle' },
    { table: 'queue_entries', column: 'joined_at' },
    { table: 'auth_tokens', column: 'expires_at' },
  ]

interface SchemaContractResult {
  readonly ok: boolean
  readonly missing: readonly string[]
  /** The check itself couldn't run (e.g. DB unreachable) — kept distinct from
   *  a verified drift so a connectivity outage is never misreported as a
   *  missing-columns list it never actually observed. */
  readonly errored: boolean
}

// A PASSING check is cached for the process lifetime: schema only changes via
// `db:push`, and a process that has already observed every required column
// doesn't need to keep asking on every probe. A FAILING check is
// deliberately NOT cached, so readiness recovers on the very next probe once
// an operator runs `db:push` against the drifted database — no restart
// needed.
let schemaContractVerified = false

async function checkSchemaContract(): Promise<SchemaContractResult> {
  if (schemaContractVerified) {
    return { ok: true, missing: [], errored: false }
  }

  const tables = [...new Set(REQUIRED_COLUMNS.map((c) => c.table))]

  let rows: { table_name: string; column_name: string }[]
  try {
    // Reuses the shared `useDb()` singleton pool (server/db/index.ts) — no
    // second connection pool. One cheap catalog query, not a query per table.
    const db = useDb()
    const tableList = sql.join(
      tables.map((t) => sql`${t}`),
      sql`, `,
    )
    rows = (await db.execute(
      sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN (${tableList})`,
    )) as unknown as { table_name: string; column_name: string }[]
  } catch (error) {
    // DB unreachable entirely. Report it once, as its own distinct failure —
    // never fabricate a "missing columns" list for a query that never ran.
    logger.error('[ready] schema contract check could not query the database:', error)
    return { ok: false, missing: [], errored: true }
  }

  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`))
  const missing = REQUIRED_COLUMNS.filter((c) => !present.has(`${c.table}.${c.column}`)).map(
    (c) => `${c.table}.${c.column}`,
  )

  if (missing.length > 0) {
    logger.error(
      `[ready] schema drift: missing column(s) ${missing.join(', ')} — run \`bun run db:push\` against this database`,
    )
    return { ok: false, missing, errored: false }
  }

  schemaContractVerified = true
  return { ok: true, missing: [], errored: false }
}
