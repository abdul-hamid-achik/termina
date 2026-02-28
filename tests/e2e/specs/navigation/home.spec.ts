import { test, expect } from '@playwright/test'
import { HomePage } from '../../pages/home.page'

test.describe('Home Page', () => {
  test('ASCII TERMINA logo and tagline render', async ({ page }) => {
    const homePage = new HomePage(page)
    await homePage.goto()
    await expect(homePage.logo).toBeVisible()
    await expect(homePage.tagline).toBeVisible()
  })

  test('"ENTER THE TERMINAL" links to /lobby', async ({ page }) => {
    const homePage = new HomePage(page)
    await homePage.goto()
    await expect(homePage.enterTerminalButton).toHaveAttribute('href', '/lobby')
  })

  test('"LEARN COMMANDS" links to /learn', async ({ page }) => {
    const homePage = new HomePage(page)
    await homePage.goto()
    await expect(homePage.learnCommandsButton).toHaveAttribute('href', '/learn')
  })
})
