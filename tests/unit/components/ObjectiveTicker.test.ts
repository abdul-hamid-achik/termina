import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ObjectiveTicker from '~~/app/components/game/ObjectiveTicker.vue'
import { TENANT_RESPAWN_TICKS } from '~~/shared/constants/balance'
import { ticksToClock } from '~~/app/utils/strategy'

function mountTicker(props: Record<string, unknown>) {
  return mount(ObjectiveTicker, {
    props: { tenant: null, runes: [], backup: null, tick: 0, ...props },
  })
}

describe('ObjectiveTicker', () => {
  it('shows Tenant up with hp%', () => {
    const w = mountTicker({ tenant: { alive: true, hp: 4000, maxHp: 5000, deathTick: null } })
    expect(w.text()).toContain('UP')
    expect(w.text()).toContain('80%')
  })

  it('shows the Tenant respawn countdown as a clock, not a tick count', () => {
    const w = mountTicker({
      tenant: { alive: false, hp: 0, maxHp: 5000, deathTick: 100 },
      tick: 120,
    })
    const ticksLeft = 100 + TENANT_RESPAWN_TICKS - 120
    expect(w.text()).toContain('dead')
    // Contesting the next Tenant is a wall-clock call — 70t means nothing.
    expect(w.text()).toContain(ticksToClock(ticksLeft))
    expect(w.text()).not.toContain(`${ticksLeft}t`)
  })

  it('shows a live rune, WHERE it is, and its expiry', () => {
    const w = mountTicker({ runes: [{ zone: 'cache-top', type: 'haste', tick: 50 }], tick: 60 })
    // Rune type ids render through buffLabel ('haste' → 'Haste', 'dd' → 'Double Damage').
    expect(w.text()).toContain('Haste')
    // The zone is the whole decision — a rune you cannot reach before it expires
    // is not an objective. formatRunes already returned it; the ticker dropped it.
    expect(w.text()).toContain('Seawall Cache Drop')
  })

  it('names the zone of whichever rune is live, not a fixed spot', () => {
    const w = mountTicker({ runes: [{ zone: 'cache-bot', type: 'dd', tick: 50 }], tick: 60 })
    expect(w.text()).toContain('Shallows Cache Drop')
    expect(w.text()).not.toContain('Seawall Cache Drop')
  })

  it('shows next rune timer when none are live', () => {
    const w = mountTicker({ runes: [], tick: 55 })
    expect(w.text()).toContain('next')
  })

  it('shows the backup carrier when held', () => {
    const w = mountTicker({ backup: null, backupHolder: { name: 'Lina', ticksRemaining: 100 } })
    expect(w.text()).toContain('Lina')
  })

  it('shows backup waiting in the pit', () => {
    const w = mountTicker({ backup: { zone: 'hollow', tick: 1, holderId: null } })
    expect(w.text()).toContain('in pit')
  })

  it('shows a dash when there is no backup', () => {
    const w = mountTicker({ backup: null })
    expect(w.text()).toContain('—')
  })
})
