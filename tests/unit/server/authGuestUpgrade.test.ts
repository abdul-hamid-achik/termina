/**
 * Live finding (Oct 2026 playtest): after a SUCCESSFUL register (POST 200) the nav
 * kept showing "[GUEST]" and "[SIGN IN] to keep progress". Cause: the auth
 * handlers wrote the session with `setUserSession`, which DEEP-MERGES (defu) the
 * new user into the session already in the cookie — and the guest session's
 * `guest: true` is a key the registered user object never mentions, so it
 * survived. The session must be REPLACED.
 *
 * The stubs below carry nuxt-auth-utils 0.5 + h3 1.15 REAL semantics (read from
 * node_modules, see session.js / h3 useSession):
 *   setUserSession     = session.update(defu(data, session.data))
 *   replaceUserSession = session.clear() + session.update(data)
 * and h3's clear() only deletes the in-request cache and blanks the Set-Cookie —
 * it never touches the REQUEST cookie, so update() re-reads the old data and
 * applies `Object.assign(data, update)`: a TOP-LEVEL shallow merge, not a replace.
 * A regression to the deep-merging call (or a handler that forgets a top-level
 * key) fails here, not only in the browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defu } from 'defu'
import { Effect } from 'effect'
import type { H3Event } from 'h3'

type Session = { user?: Record<string, unknown>; secure?: Record<string, unknown> }
/** The session cookie the browser SENT with this request (h3 re-reads it on every getSession). */
let incoming: Session = {}
/** The session data the response will Set-Cookie. */
let session: Session = {}

const GUEST_SESSION: Session = {
  user: {
    id: 'guest_a1b2c3d4e5f6',
    username: 'GUEST-A1B2',
    avatarUrl: null,
    selectedAvatar: null,
    provider: 'local',
    hasPassword: false,
    tutorialCompleted: false,
    guest: true,
  },
}

const registered = {
  id: 'local_9f2c1e',
  username: 'newplayer',
  avatarUrl: null,
  selectedAvatar: null,
  tutorialCompleted: false,
  passwordHash: 'hash',
}

vi.stubGlobal('defineEventHandler', (fn: (event: H3Event) => unknown) => fn)
vi.stubGlobal('createError', (opts: { statusCode: number; message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
})
vi.stubGlobal('getRequestIP', () => '203.0.113.5')
vi.stubGlobal('readBody', async (event: H3Event) => (event as unknown as { body: unknown }).body)
vi.stubGlobal('hashPassword', async () => 'hash')
vi.stubGlobal('verifyPassword', async () => true)
vi.stubGlobal('useRuntimeConfig', () => ({ appUrl: 'http://localhost' }))
// h3 getSession: (re)load from the incoming cookie, then Object.assign(session.data, update).
const h3Update = (update: Session) => {
  const data = structuredClone(incoming) as Record<string, unknown>
  Object.assign(data, update)
  session = data as Session
  return session
}
// nuxt-auth-utils: await session.update(defu(data, session.data))
vi.stubGlobal('setUserSession', async (_e: H3Event, data: Session) => {
  return h3Update(defu(data, incoming) as Session)
})
// nuxt-auth-utils: clear() (request cookie untouched) then update(data)
vi.stubGlobal('replaceUserSession', async (_e: H3Event, data: Session) => {
  return h3Update(data)
})

vi.mock('~~/server/utils/RateLimiter', () => ({ checkScopedRateLimit: vi.fn(() => true) }))
vi.mock('~~/server/utils/email', () => ({ sendEmail: vi.fn() }))
vi.mock('~~/server/utils/authTokens', () => ({ createVerifyToken: vi.fn() }))
vi.mock('~~/server/plugins/game-server', () => ({
  getGameRuntime: () => ({
    dbService: {
      getPlayerByUsername: (name: string) =>
        Effect.succeed(name === 'newplayer' ? null : name === 'oldtimer' ? registered : null),
      createLocalPlayer: () => Effect.succeed(registered),
    },
  }),
}))

const event = (body: unknown) => ({ body }) as unknown as H3Event
const registerHandler = (await import('~~/server/api/auth/register.post')).default as (
  e: H3Event,
) => Promise<{ user: Record<string, unknown> }>
const loginHandler = (await import('~~/server/api/auth/login.post')).default as (
  e: H3Event,
) => Promise<{ user: Record<string, unknown> }>

describe('a guest who registers or signs in stops being a guest', () => {
  beforeEach(() => {
    incoming = structuredClone(GUEST_SESSION)
    session = {}
  })

  it('register: the session after a 200 is the registered user — no leftover guest flag', async () => {
    const res = await registerHandler(event({ username: 'newplayer', password: 'longenough1' }))

    expect(res.user.id).toBe('local_9f2c1e')
    expect(session.user?.id).toBe('local_9f2c1e')
    expect(session.user?.guest).toBeUndefined()
    expect(session.user?.provider).toBe('local')
    expect(session.user?.hasPassword).toBe(true)
  })

  it('login: a guest signing in gets the real identity, not the guest flag', async () => {
    await loginHandler(event({ username: 'oldtimer', password: 'longenough1' }))

    expect(session.user?.id).toBe('local_9f2c1e')
    expect(session.user?.guest).toBeUndefined()
  })

  it('a stray top-level key in the old cookie (e.g. `secure`) does not survive the upgrade', async () => {
    incoming = { ...structuredClone(GUEST_SESSION), secure: { token: 'old' } }

    await registerHandler(event({ username: 'newplayer', password: 'longenough1' }))
    expect(session.secure).toBeUndefined()

    incoming = { ...structuredClone(GUEST_SESSION), secure: { token: 'old' } }
    await loginHandler(event({ username: 'oldtimer', password: 'longenough1' }))
    expect(session.secure).toBeUndefined()
  })

  it('the guest cookie carries only the `user` top-level key (the handlers enumerate every key)', async () => {
    const guestHandler = (await import('~~/server/api/auth/guest.post')).default as (
      e: H3Event,
    ) => Promise<unknown>
    incoming = {}
    await guestHandler(event({}))
    expect(Object.keys(session)).toEqual(['user'])
  })

  it('the stubbed merge semantics really would have kept the flag (guards the guard)', async () => {
    const g = globalThis as unknown as {
      setUserSession: (e: H3Event, d: Session) => Promise<Session>
      replaceUserSession: (e: H3Event, d: Session) => Promise<Session>
    }
    // deep merge keeps the guest flag...
    await g.setUserSession(event({}), { user: { id: 'local_9f2c1e' } })
    expect(session.user?.guest).toBe(true)
    // ...and a bare replace is only a shallow merge: unlisted top-level keys survive.
    incoming = { ...structuredClone(GUEST_SESSION), secure: { token: 'old' } }
    await g.replaceUserSession(event({}), { user: { id: 'local_9f2c1e' } })
    expect(session.user?.guest).toBeUndefined()
    expect(session.secure).toEqual({ token: 'old' })
  })
})
