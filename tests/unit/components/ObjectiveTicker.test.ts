import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ObjectiveTicker from '../../../app/components/game/ObjectiveTicker.vue'
import { ROSHAN_RESPAWN_TICKS } from '../../../shared/constants/balance'

function mountTicker(props: Record<string, unknown>) {
  return mount(ObjectiveTicker, {
    props: { roshan: null, runes: [], aegis: null, tick: 0, ...props },
  })
}

describe('ObjectiveTicker', () => {
  it('shows Roshan up with hp%', () => {
    const w = mountTicker({ roshan: { alive: true, hp: 4000, maxHp: 5000, deathTick: null } })
    expect(w.text()).toContain('UP')
    expect(w.text()).toContain('80%')
  })

  it('shows Roshan respawn countdown when dead', () => {
    const w = mountTicker({
      roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: 100 },
      tick: 120,
    })
    expect(w.text()).toContain('dead')
    expect(w.text()).toContain(`${100 + ROSHAN_RESPAWN_TICKS - 120}t`)
  })

  it('shows a live rune and its expiry', () => {
    const w = mountTicker({ runes: [{ zone: 'rune-top', type: 'haste', tick: 50 }], tick: 60 })
    expect(w.text()).toContain('haste')
  })

  it('shows next rune timer when none are live', () => {
    const w = mountTicker({ runes: [], tick: 55 })
    expect(w.text()).toContain('next')
  })

  it('shows the aegis carrier when held', () => {
    const w = mountTicker({ aegis: null, aegisHolder: { name: 'Lina', ticksRemaining: 100 } })
    expect(w.text()).toContain('Lina')
  })

  it('shows aegis waiting in the pit', () => {
    const w = mountTicker({ aegis: { zone: 'roshan-pit', tick: 1, holderId: null } })
    expect(w.text()).toContain('in pit')
  })

  it('shows a dash when there is no aegis', () => {
    const w = mountTicker({ aegis: null })
    expect(w.text()).toContain('—')
  })
})
