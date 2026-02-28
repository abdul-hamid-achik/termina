/* eslint-disable no-console */
import type { FullConfig } from '@playwright/test'

export default async function globalSetup(_config: FullConfig) {
  const dbUrl =
    process.env.NUXT_DATABASE_URL ??
    'postgresql://termina:termina@localhost:5432/termina_test'

  console.log('[e2e] Global setup — ensuring test database exists')
  console.log(`[e2e] Database URL: ${dbUrl.replace(/:[^@]+@/, ':***@')}`)

  // Create test database if it doesn't exist
  const { default: postgres } = await import('postgres')

  // Connect to the default 'postgres' database to create our test DB
  const adminUrl = dbUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
  const adminSql = postgres(adminUrl)

  try {
    const dbName = new URL(dbUrl).pathname.slice(1)
    const result = await adminSql`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `
    if (result.length === 0) {
      console.log(`[e2e] Creating database: ${dbName}`)
      await adminSql.unsafe(`CREATE DATABASE "${dbName}"`)
    } else {
      console.log(`[e2e] Database "${dbName}" already exists`)
    }
  } catch (err) {
    console.warn('[e2e] Could not check/create database:', err)
  } finally {
    await adminSql.end()
  }

  // Push schema to the test database
  try {
    const testSql = postgres(dbUrl)
    const tables = await testSql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' LIMIT 1
    `
    if (tables.length === 0) {
      console.log('[e2e] No tables found — pushing schema with drizzle-kit...')
      const { execSync } = await import('node:child_process')
      execSync('bunx drizzle-kit push --force', {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl },
      })
      console.log('[e2e] Schema pushed successfully')
    } else {
      console.log('[e2e] Test database has tables — ready')
    }
    await testSql.end()
  } catch (err) {
    console.warn('[e2e] Could not push schema:', err)
  }
}
