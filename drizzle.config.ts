import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Always explicit, never a literal: `tvault -p termina-local run -- bun run db:push`
    // locally, or DATABASE_URL pointed at a Neon branch for a deliberate push.
    // Deliberately NOT a throw at load: knip's drizzle plugin (and lefthook's
    // pre-commit knip job) load this file with no secrets in the environment. An
    // unset var yields '' here, and drizzle-kit rejects an empty url itself when a
    // command actually needs a connection (`push` fails with a clear message).
    url: process.env.DATABASE_URL ?? '',
  },
})
