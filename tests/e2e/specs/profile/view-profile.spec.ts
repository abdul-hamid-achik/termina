import { test, expect } from '../../fixtures/base'
import { generateTestUser } from '../../helpers/auth'

test.describe('View Profile', () => {
  test('/profile/me shows current user info', async ({ authenticatedPage, testUser }) => {
    const page = authenticatedPage
    await page.goto('/profile/me')
    // Should show the username somewhere on the page
    await expect(page.getByText(testUser.username)).toBeVisible({ timeout: 5_000 })
  })

  test('[EDIT] link visible only on own profile', async ({ authenticatedPage, request }) => {
    const page = authenticatedPage

    // Own profile: [EDIT] links to the settings page
    await page.goto('/profile/me')
    const editLink = page.getByRole('link', { name: '[EDIT]' })
    await expect(editLink).toBeVisible()
    await expect(editLink).toHaveAttribute('href', '/profile/settings')

    // Another user's profile: [EDIT] must be absent
    const other = generateTestUser()
    const res = await request.post('/api/auth/register', {
      data: { username: other.username, password: other.password },
    })
    expect(res.ok(), 'second user registration').toBeTruthy()
    const body = (await res.json()) as { user: { id: string } }

    await page.goto(`/profile/${body.user.id}`)
    await expect(page.getByText(other.username)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('link', { name: '[EDIT]' })).toHaveCount(0)
  })

  test('empty matches state shows appropriate message', async ({ authenticatedPage }) => {
    const page = authenticatedPage
    await page.goto('/profile/me')
    // A freshly registered user has played no matches
    await expect(page.getByText('No matches played yet.')).toBeVisible({ timeout: 5_000 })
  })
})
