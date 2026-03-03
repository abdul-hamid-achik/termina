/* eslint-disable no-console */
import type { FullConfig } from '@playwright/test'

export default async function globalTeardown(_config: FullConfig) {
  const dbUrl =
    process.env.NUXT_DATABASE_URL ??
    'postgresql://termina:termina@localhost:5432/termina_test'

  console.log('[e2e] Global teardown — cleaning up test data')

  const { default: postgres } = await import('postgres')
  const sql = postgres(dbUrl)

  try {
    // Find test user IDs first
    const testUsers = await sql`
      SELECT id FROM players
      WHERE username LIKE 't_%' OR username LIKE 'canary_%'
    `
    const ids = testUsers.map(r => r.id)

    if (ids.length > 0) {
      // Delete from child tables first (no CASCADE on FKs)
      await sql`DELETE FROM hero_stats WHERE player_id = ANY(${ids})`
      await sql`DELETE FROM match_players WHERE player_id = ANY(${ids})`
      await sql`DELETE FROM player_providers WHERE player_id = ANY(${ids})`
      await sql`DELETE FROM players WHERE id = ANY(${ids})`
    }

    console.log(`[e2e] Cleaned up ${ids.length} test users`)
  } catch (err) {
    console.warn('[e2e] Teardown cleanup error:', err)
  } finally {
    await sql.end()
  }
}
