import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

let _db: ReturnType<typeof createDb> | null = null

function createDb() {
  const config = useRuntimeConfig()
  const connectionString = config.database.url as string
  const client = postgres(connectionString)
  return drizzle(client, { schema })
}

export function useDb() {
  if (!_db) {
    _db = createDb()
  }
  return _db
}

export type Database = ReturnType<typeof useDb>
export { schema }
