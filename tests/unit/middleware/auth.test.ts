import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'

// The middleware is written against Nuxt auto-imports; stub them as globals
// (the project's established pattern — see stores/auth.test.ts) and import the
// module lazily so `defineNuxtRouteMiddleware` exists when it evaluates.
const mockNavigateTo = vi.fn()
const loggedIn = ref(false)

async function loadMiddleware() {
  vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
  vi.stubGlobal('navigateTo', mockNavigateTo)
  vi.stubGlobal('useUserSession', () => ({ loggedIn }))
  const mod = await import('../../../app/middleware/auth')
  return mod.default as (to: RouteLocationNormalized) => unknown
}

function route(fullPath: string): RouteLocationNormalized {
  return { fullPath } as RouteLocationNormalized
}

beforeEach(() => {
  mockNavigateTo.mockReset()
  loggedIn.value = false
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('auth middleware', () => {
  it('lets a signed-in player through untouched', async () => {
    loggedIn.value = true
    const middleware = await loadMiddleware()

    expect(middleware(route('/lobby'))).toBeUndefined()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('sends a logged-out player to login carrying the destination', async () => {
    const middleware = await loadMiddleware()

    middleware(route('/lobby'))

    expect(mockNavigateTo).toHaveBeenCalledWith({
      path: '/login',
      query: { redirect: '/lobby' },
    })
  })

  it('preserves the query string of the destination', async () => {
    const middleware = await loadMiddleware()

    middleware(route('/play?gameId=g7&tutorial=1'))

    expect(mockNavigateTo).toHaveBeenCalledWith({
      path: '/login',
      query: { redirect: '/play?gameId=g7&tutorial=1' },
    })
  })

  it('preserves a nested destination path', async () => {
    const middleware = await loadMiddleware()

    middleware(route('/profile/settings'))

    expect(mockNavigateTo).toHaveBeenCalledWith({
      path: '/login',
      query: { redirect: '/profile/settings' },
    })
  })
})
