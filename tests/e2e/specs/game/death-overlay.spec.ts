import { test, expect } from '../../fixtures/game'

/**
 * Death overlay — provokes a REAL death instead of passing vacuously.
 *
 * Strategy: walk mid lane into the dire T1 tower zone, then attack the tower
 * every tick. TowerAI prioritizes enemy heroes that attacked the tower this
 * tick, so the tower (TOWER_ATTACK=120/tick vs ~500-600 level-1 hero HP)
 * reliably kills us within a handful of ticks. Enemy bots in the zone only
 * speed this up. Once dead we assert the overlay content, then assert it
 * clears again on respawn — all in one game so the suite doesn't pay for a
 * second matchmaking cycle.
 */
test.describe('Death Overlay', () => {
  test('death shows "PROCESS TERMINATED" overlay, then clears on respawn', async ({
    gamePage,
  }) => {
    test.setTimeout(300_000)

    const input = gamePage.getByTestId('command-input-field')
    const deathOverlay = gamePage.getByTestId('death-overlay')

    const submit = async (cmd: string) => {
      await input.fill(cmd, { timeout: 5_000 }).catch(() => {})
      await input.press('Enter', { timeout: 5_000 }).catch(() => {})
    }

    // March mid lane toward dire territory — one zone per 4s tick.
    const path = [
      'radiant-base',
      'mid-t3-rad',
      'mid-t2-rad',
      'mid-t1-rad',
      'mid-river',
      'mid-t1-dire',
    ]
    for (const zone of path) {
      if (await deathOverlay.isVisible()) break // bots may already have killed us
      await submit(`move ${zone}`)
      await gamePage.waitForTimeout(4_500)
    }

    // Provoke the tower until it kills us. Attacking the tower each tick
    // keeps us at the top of its target priority.
    for (let i = 0; i < 25; i++) {
      if (await deathOverlay.isVisible()) break
      await submit('attack tower:mid-t1-dire')
      await gamePage.waitForTimeout(4_000)
    }

    // Honest assertions: we must actually be dead now.
    await expect(deathOverlay).toBeVisible({ timeout: 10_000 })
    await expect(gamePage.getByText('PROCESS TERMINATED')).toBeVisible()
    await expect(gamePage.getByText(/Respawning in/)).toBeVisible()

    // ...and the overlay clears once the respawn timer elapses
    // (3 base ticks + per-level scaling — well under a minute at low level).
    await expect(deathOverlay).not.toBeVisible({ timeout: 90_000 })
  })
})
