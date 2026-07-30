import { describe, it, expect } from 'vitest'
import { HERO_IDS } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import { OBJECTIVE_LABELS } from '~~/shared/constants/world'
import { ZONE_IDS } from '~~/shared/constants/zones'

/**
 * R1 naming law guard: no new identifier may collide with one of the 18 hero
 * handles (B1a — the ids never change). The `firewall_item` id existed ONLY to
 * dodge such a collision; this test makes the rule self-enforcing so the hack
 * can never come back.
 */
describe('hero-id collision guard (the firewall_item law)', () => {
  const heroes = new Set(HERO_IDS)

  it('no zone id is a hero handle', () => {
    for (const id of ZONE_IDS) {
      expect(heroes.has(id), `zone id "${id}" collides with a hero handle`).toBe(false)
    }
  })

  it('no item id is a hero handle', () => {
    for (const id of Object.keys(ITEMS)) {
      expect(heroes.has(id), `item id "${id}" collides with a hero handle`).toBe(false)
    }
  })

  it('no objective/command word is a hero handle (grab, not cache)', () => {
    // The pickup verb is `grab` BECAUSE `cache` is a hero handle — if anyone
    // reintroduces `cache` (or another handle) as a command word this fails.
    const commandWords = ['grab', 'ward', 'backup', 'harden', 'buyback', 'surrender', 'burn']
    for (const word of commandWords) {
      expect(heroes.has(word), `command word "${word}" collides with a hero handle`).toBe(false)
    }
    // Belt and braces: `cache` and `sentry` ARE handles — assert the registry
    // knows that, so the two resolved collisions stay resolved on purpose.
    expect(heroes.has('cache')).toBe(true)
    expect(heroes.has('sentry')).toBe(true)
    expect(heroes.has('firewall')).toBe(true)
  })

  it('objective labels carry no bare hero handle', () => {
    const labels = [
      OBJECTIVE_LABELS.tenant,
      OBJECTIVE_LABELS.backup,
      ...Object.values(OBJECTIVE_LABELS.cache),
    ]
    for (const label of labels) {
      expect(heroes.has(label.toLowerCase()), `objective label "${label}" collides`).toBe(false)
    }
  })
})
