import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/base'

/**
 * No-horizontal-overflow assertions for the key pages — runs only in the
 * `mobile-chromium` project (Pixel 7 viewport). A page that overflows the
 * viewport horizontally forces sideways panning on phones, which the
 * terminal layout must never do.
 */
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    scrollWidth,
    `${label}: page overflows horizontally (scrollWidth ${scrollWidth}px > innerWidth ${innerWidth}px)`,
  ).toBeLessThanOrEqual(innerWidth)
}

test.describe('No horizontal overflow on mobile', () => {
  const publicPages = [
    { path: '/', label: 'home' },
    { path: '/login', label: 'login' },
    { path: '/learn', label: 'learn' },
    { path: '/leaderboard', label: 'leaderboard' },
  ]

  for (const { path, label } of publicPages) {
    test(`${label} page has no horizontal overflow`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoHorizontalOverflow(page, label)
    })
  }

  test('lobby page has no horizontal overflow', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/lobby')
    await page.waitForLoadState('networkidle')
    await expectNoHorizontalOverflow(page, 'lobby')
  })
})
