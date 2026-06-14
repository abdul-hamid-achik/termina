import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EnemyThreatSheet from '../../../app/components/game/EnemyThreatSheet.vue'

function visibleEnemy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    name: 'enemy_one',
    team: 'dire',
    heroId: 'null_ref',
    zone: 'mid-river',
    hp: 500,
    maxHp: 1000,
    mp: 200,
    maxMp: 400,
    level: 7,
    alive: true,
    cooldowns: { q: 0, w: 3, e: 0, r: 5 },
    items: [],
    ...overrides,
  }
}

describe('EnemyThreatSheet', () => {
  it('shows vitals + ability cooldowns for a visible enemy', () => {
    const w = mount(EnemyThreatSheet, {
      props: { enemies: [visibleEnemy()], lastSeen: {}, tick: 10 },
    })
    const cds = w.get('[data-testid="threat-cooldowns-e1"]').text()
    // ready abilities show no number, ones on cooldown show the tick count
    expect(cds).toContain('Q')
    expect(cds).toContain('W3')
    expect(cds).toContain('R5')
  })

  it('shows a respawn countdown for a dead enemy', () => {
    const w = mount(EnemyThreatSheet, {
      props: {
        enemies: [visibleEnemy({ alive: false, respawnTick: 40 })],
        lastSeen: {},
        tick: 25,
      },
    })
    const el = w.get('[data-testid="threat-dead-e1"]')
    expect(el.text()).toContain('respawn 15t')
  })

  it('shows last-seen intel for a fogged enemy', () => {
    const fogged = {
      id: 'e2',
      name: 'enemy_two',
      team: 'dire',
      heroId: 'regex',
      level: 6,
      alive: true,
      fogged: true,
    }
    const w = mount(EnemyThreatSheet, {
      props: { enemies: [fogged], lastSeen: { e2: { zone: 'top-river', tick: 6 } }, tick: 10 },
    })
    const el = w.get('[data-testid="threat-fogged-e2"]')
    expect(el.text()).toContain('fogged')
    expect(el.text()).toContain('top-river')
    expect(el.text()).toContain('4t')
  })

  it('shows an empty state with no enemies', () => {
    const w = mount(EnemyThreatSheet, { props: { enemies: [], lastSeen: {}, tick: 0 } })
    expect(w.text()).toContain('no enemy intel')
  })

  it('never renders HP/MP/cooldowns for a fogged enemy (fog-safe)', () => {
    const fogged = {
      id: 'e3',
      name: 'enemy_three',
      team: 'dire',
      heroId: 'cache',
      level: 5,
      alive: true,
      fogged: true,
    }
    const w = mount(EnemyThreatSheet, { props: { enemies: [fogged], lastSeen: {}, tick: 0 } })
    expect(w.find('[data-testid="threat-cooldowns-e3"]').exists()).toBe(false)
    expect(w.find('[data-testid="threat-fogged-e3"]').exists()).toBe(true)
  })

  it('does not show a misleading "respawn 0t" for a fogged-dead enemy', () => {
    const foggedDead = {
      id: 'e4',
      name: 'enemy_four',
      team: 'dire',
      heroId: 'regex',
      level: 5,
      alive: false,
      fogged: true,
    }
    const w = mount(EnemyThreatSheet, { props: { enemies: [foggedDead], lastSeen: {}, tick: 10 } })
    const el = w.get('[data-testid="threat-dead-e4"]')
    expect(el.text()).toContain('DEAD')
    expect(el.text()).not.toContain('respawn')
  })
})
