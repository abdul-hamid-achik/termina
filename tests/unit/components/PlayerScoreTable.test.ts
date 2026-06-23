import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerScoreTable, {
  type PlayerScoreRow,
} from '../../../app/components/game/PlayerScoreTable.vue'

function row(overrides: Partial<PlayerScoreRow> = {}): PlayerScoreRow {
  return {
    id: 'p1',
    heroName: 'Daemon',
    level: 12,
    hp: 800,
    maxHp: 1200,
    kills: 5,
    deaths: 2,
    assists: 7,
    gold: 12450,
    zone: 'mid-river',
    alive: true,
    ...overrides,
  }
}

function mountTable(rows: PlayerScoreRow[], caption = 'Radiant players') {
  return mount(PlayerScoreTable, { props: { caption, rows } })
}

describe('PlayerScoreTable', () => {
  it('renders the sr-only caption and a row per player', () => {
    const wrapper = mountTable([
      row({ id: 'a', heroName: 'Daemon' }),
      row({ id: 'b', heroName: 'Socket' }),
    ])
    expect(wrapper.find('caption').text()).toBe('Radiant players')
    const bodyRows = wrapper.findAll('tbody tr')
    expect(bodyRows).toHaveLength(2)
    expect(wrapper.text()).toContain('Daemon')
    expect(wrapper.text()).toContain('Socket')
  })

  it('shows hp/maxHp when present and "?" when absent (replay snapshot)', () => {
    const withHp = mountTable([row({ hp: 800, maxHp: 1200 })])
    expect(withHp.text()).toContain('800')
    expect(withHp.text()).toContain('/1200')

    const noHp = mountTable([row({ hp: undefined, maxHp: undefined })])
    // No HP numbers, a literal "?" placeholder instead.
    expect(noHp.text()).toContain('?')
    expect(noHp.text()).not.toContain('/1200')
  })

  it('formats gold with thousands separators and renders K/D/A', () => {
    const wrapper = mountTable([row({ gold: 12450, kills: 5, deaths: 2, assists: 7 })])
    expect(wrapper.text()).toContain('12,450')
    // K/D/A renders the three numbers in order.
    expect(wrapper.text()).toMatch(/5\s*\/\s*2\s*\/\s*7/)
  })

  it('dims dead players (opacity-50) and keeps living ones full', () => {
    const wrapper = mountTable([
      row({ id: 'alive', alive: true }),
      row({ id: 'dead', alive: false }),
    ])
    const trs = wrapper.findAll('tbody tr')
    expect(trs[0]!.classes()).not.toContain('opacity-50')
    expect(trs[1]!.classes()).toContain('opacity-50')
  })

  it('shows the [AI] tag only for AFK→bot-controlled players', () => {
    const human = mountTable([row({ aiControlled: false })])
    expect(human.text()).not.toContain('[AI]')

    const bot = mountTable([row({ aiControlled: true })])
    expect(bot.text()).toContain('[AI]')
  })

  it('renders just the header (no body rows) for an empty team', () => {
    const wrapper = mountTable([])
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    // Column headers still present so the table is announced correctly.
    expect(wrapper.findAll('thead th').length).toBeGreaterThan(0)
  })
})
