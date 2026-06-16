import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FocusBanner from '../../../app/components/game/FocusBanner.vue'
import { useGameStore } from '../../../app/stores/game'
import type { PlayerState } from '../../../shared/types/game'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'me',
    name: 'me',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 600,
    maxHp: 600,
    mp: 200,
    maxMp: 300,
    level: 6,
    xp: 0,
    gold: 500,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

/** Seed the store: local player + N enemies + M allies, all in mid-river. */
function seed(opts: { me?: Partial<PlayerState>; enemies?: number; allies?: number } = {}) {
  const store = useGameStore()
  const me = makePlayer({ id: 'me', ...opts.me })
  const all: Record<string, PlayerState> = { me }
  for (let i = 0; i < (opts.enemies ?? 0); i++)
    all[`e${i}`] = makePlayer({ id: `e${i}`, team: 'dire' })
  for (let i = 0; i < (opts.allies ?? 0); i++)
    all[`a${i}`] = makePlayer({ id: `a${i}`, team: 'radiant' })
  store.playerId = 'me'
  store.player = me
  store.allPlayers = all
  return store
}

describe('FocusBanner', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows CLEAR with a farm/push recommendation when no enemies are near', () => {
    seed({ enemies: 0 })
    const wrapper = mount(FocusBanner)

    expect(wrapper.find('[data-testid="focus-threat"]').text()).toBe('CLEAR')
    expect(wrapper.find('[data-testid="focus-recommendation"]').text().toLowerCase()).toContain(
      'farm',
    )
  })

  it('shows CONTESTED for an even 1v1', () => {
    seed({ enemies: 1, allies: 0 })
    const wrapper = mount(FocusBanner)
    expect(wrapper.find('[data-testid="focus-threat"]').text()).toBe('CONTESTED')
  })

  it('shows DANGER and advises retreat when outnumbered', () => {
    seed({ enemies: 2, allies: 0 })
    const wrapper = mount(FocusBanner)

    expect(wrapper.find('[data-testid="focus-threat"]').text()).toBe('DANGER')
    expect(wrapper.find('[data-testid="focus-recommendation"]').text()).toContain('retreat')
  })

  it('shows FAVORED when allies outnumber enemies', () => {
    seed({ enemies: 1, allies: 1 })
    const wrapper = mount(FocusBanner)
    expect(wrapper.find('[data-testid="focus-threat"]').text()).toBe('FAVORED')
  })

  it('prioritises a low-HP warning over the threat verdict', () => {
    seed({ me: { hp: 100, maxHp: 600 }, enemies: 1 })
    const wrapper = mount(FocusBanner)
    expect(wrapper.find('[data-testid="focus-recommendation"]').text()).toContain('Low HP')
  })

  it('shows a dead recommendation when the hero is dead', () => {
    seed({ me: { alive: false, hp: 0 }, enemies: 1 })
    const wrapper = mount(FocusBanner)
    expect(wrapper.find('[data-testid="focus-recommendation"]').text()).toContain('Dead')
  })

  it('renders a chip for each off-cooldown ability and none for those on cooldown', () => {
    seed({ me: { cooldowns: { q: 0, w: 3, e: 0, r: 8 } } })
    const wrapper = mount(FocusBanner)

    expect(wrapper.find('[data-testid="focus-ready-q"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="focus-ready-e"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="focus-ready-w"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="focus-ready-r"]').exists()).toBe(false)
  })

  it('shows an empty ready indicator when every ability is on cooldown', () => {
    seed({ me: { cooldowns: { q: 2, w: 3, e: 1, r: 8 } } })
    const wrapper = mount(FocusBanner)
    expect(wrapper.find('[data-testid="focus-ready-none"]').exists()).toBe(true)
  })

  it('renders the prettified zone name', () => {
    seed({ enemies: 0 })
    const wrapper = mount(FocusBanner)
    // mid-river → "Mid River" via ZONE_MAP
    expect(wrapper.find('[data-testid="focus-banner"]').text()).toContain('Mid River')
  })
})
