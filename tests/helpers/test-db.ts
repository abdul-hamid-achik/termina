import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '~~/server/db/schema'

// Real Postgres connection for integration tests. Points at a disposable test DB
// (TEST_DATABASE_URL) — never the dev/prod DB. CI injects it from a GitHub
// Actions secret; locally it lives in tvault `termina-local`:
//   tvault -p termina-local run -- bun run test:db
//   tvault -p termina-local run -- bun run test:integration
const url = process.env.TEST_DATABASE_URL
if (!url) {
  throw new Error(
    'TEST_DATABASE_URL is not set — run integration tests through `tvault -p termina-local run -- …`',
  )
}

export const client = postgres(url, { max: 4, onnotice: () => {} })
export const testDb = drizzle(client, { schema })

/** Wipe every table between tests so each starts from a clean slate. */
export async function truncateAll(): Promise<void> {
  await client`TRUNCATE players, matches, match_players, match_replays, hero_stats, player_providers, queue_entries, parties, party_members RESTART IDENTITY CASCADE`
}
