import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AllyStatusSheet from '../../../app/components/game/AllyStatusSheet.vue'

function ally(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    name: 'ally_one',
    team: 'radiant',
    heroId: 'cipher',
    zone: 'mid-river',
    hp: 600,
    maxHp: 900,
    mp: 300,
    maxMp: 400,
    level: 8,
    alive: true,
    buffs: [],
    items: [],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    ...overrides,
  }
}

describe('AllyStatusSheet', () => {
  it('shows an alive ally with their level and zone', () => {
    const w = mount(AllyStatusSheet, { props: { allies: [ally()], tick: 10 } })
    const text = w.text()
    expect(text).toContain('Lv8')
    expect(text).toContain('mid-river')
  })

  it('shows a respawn countdown for a dead ally', () => {
    const w = mount(AllyStatusSheet, {
      props: { allies: [ally({ alive: false, respawnTick: 40 })], tick: 25 },
    })
    expect(w.get('[data-testid="ally-dead-a1"]').text()).toContain('respawn 15t')
  })

  it('shows the solo state when there are no allies', () => {
    const w = mount(AllyStatusSheet, { props: { allies: [], tick: 0 } })
    expect(w.text()).toContain('solo')
  })

  describe('status intel (ally perspective)', () => {
    it('colours a held buff green and a debuff red', () => {
      const w = mount(AllyStatusSheet, {
        props: {
          allies: [
            ally({
              buffs: [
                { id: 'magic_immune', stacks: 1, ticksRemaining: 4 },
                { id: 'stun', stacks: 1, ticksRemaining: 2 },
              ],
            }),
          ],
          tick: 10,
        },
      })
      const status = w.get('[data-testid="ally-status-a1"]')
      expect(status.text()).toContain('Magic Immune')
      expect(status.text()).toContain('Stunned')
      // The ally's own buff is good (green); the debuff on them is bad (red).
      expect(status.html()).toContain('text-radiant')
      expect(status.html()).toContain('text-dire')
    })

    it('drops near-permanent stat auras from the status line', () => {
      const w = mount(AllyStatusSheet, {
        props: {
          allies: [
            ally({ buffs: [{ id: 'power_treads_attack', stacks: 15, ticksRemaining: 999 }] }),
          ],
          tick: 10,
        },
      })
      expect(w.find('[data-testid="ally-status-a1"]').exists()).toBe(false)
    })
  })
})
