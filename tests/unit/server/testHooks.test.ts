import { describe, it, expect, afterEach } from 'vitest'
import { testHooksEnabled } from '../../../server/utils/testHooks'

/**
 * Locks the production-safety gate for the dangerous `server/api/test/*` hooks
 * (e.g. `login-as` mints a session for ANY username — an auth bypass). The
 * documented security model: the SOLE gate is the exact `TERMINA_TEST_HOOKS=1`
 * opt-in, and NODE_ENV is intentionally NOT part of it (the e2e suite runs on a
 * production build). These tests encode that model so a regression can't silently
 * widen the gate.
 */
describe('testHooksEnabled (production safety gate)', () => {
  const original = process.env.TERMINA_TEST_HOOKS
  const originalNodeEnv = process.env.NODE_ENV

  const restore = (key: 'TERMINA_TEST_HOOKS' | 'NODE_ENV', value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  afterEach(() => {
    restore('TERMINA_TEST_HOOKS', original)
    restore('NODE_ENV', originalNodeEnv)
  })

  it('is OFF by default when the opt-in is unset', () => {
    delete process.env.TERMINA_TEST_HOOKS
    expect(testHooksEnabled()).toBe(false)
  })

  it('is ON for the exact opt-in "1"', () => {
    process.env.TERMINA_TEST_HOOKS = '1'
    expect(testHooksEnabled()).toBe(true)
  })

  it.each(['0', '', 'true', 'TRUE', 'yes', 'on', '01', '1 ', ' 1', 'enabled', '2'])(
    'stays OFF for non-"1" value %p (strict equality, no truthiness)',
    (value) => {
      process.env.TERMINA_TEST_HOOKS = value
      expect(testHooksEnabled()).toBe(false)
    },
  )

  it('stays OFF under NODE_ENV=production when the opt-in is unset (NODE_ENV is not the gate)', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TERMINA_TEST_HOOKS
    expect(testHooksEnabled()).toBe(false)
  })

  it('honors the opt-in even under NODE_ENV=production (e2e runs against a prod build)', () => {
    process.env.NODE_ENV = 'production'
    process.env.TERMINA_TEST_HOOKS = '1'
    expect(testHooksEnabled()).toBe(true)
  })
})
