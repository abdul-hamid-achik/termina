import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '~~/server/db/schema'

// Real Postgres connection for integration tests. Points at a disposable test DB
// (TEST_DATABASE_URL, default termina_test) — never the dev/prod DB. CI provisions
// it as a service + `drizzle-kit push`es the schema; locally: docker compose up +
// `DATABASE_URL=…/termina_test npx drizzle-kit push --force`.
const url =
  process.env.TEST_DATABASE_URL ?? 'postgresql://termina:termina@localhost:5433/termina_test'

export const client = postgres(url, { max: 4, onnotice: () => {} })
export const testDb = drizzle(client, { schema })

/** Wipe every table between tests so each starts from a clean slate. */
export async function truncateAll(): Promise<void> {
  await client`TRUNCATE players, matches, match_players, hero_stats, player_providers RESTART IDENTITY CASCADE`
}
