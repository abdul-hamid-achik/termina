import { test as base, type Page } from '@playwright/test'
import { generateTestUser, registerAndLogin, type TestUser } from '../helpers/auth'

type BaseFixtures = {
  testUser: TestUser
  authenticatedPage: Page
}

export const test = base.extend<BaseFixtures>({
  // eslint-disable-next-line no-empty-pattern
  testUser: async ({}, use) => {
    const user = generateTestUser()
    await use(user)
  },

  authenticatedPage: async ({ page, request, testUser }, use) => {
    // Register and login via API
    const { cookies } = await registerAndLogin(request, testUser)

    // Apply cookies to the page context
    await page.context().addCookies(
      cookies.cookies.map((c) => ({
        ...c,
        sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None') ?? 'Lax',
      })),
    )

    // Navigate to / to hydrate the session (needed for SSR-disabled pages like /lobby)
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await use(page)
  },
})

export { expect } from '@playwright/test'
