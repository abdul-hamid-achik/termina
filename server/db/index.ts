import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

let _db: ReturnType<typeof createDb> | null = null
let _client: ReturnType<typeof postgres> | null = null

function createDb() {
  const config = useRuntimeConfig()
  const connectionString = (config.database as { url: string }).url
  // Configure a connection pool with sensible defaults for a game server:
  // max connections, prepared statements, and statement timeout to prevent
  // a single slow query from exhausting the pool.
  const client = postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
  })
  _client = client
  return drizzle(client, { schema })
}

export function useDb() {
  if (!_db) {
    _db = createDb()
  }
  return _db
}

/** Gracefully close the postgres connection pool. Called on Nitro shutdown. */
export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end()
    _client = null
    _db = null
  }
}

export type Database = ReturnType<typeof useDb>
export { schema }
