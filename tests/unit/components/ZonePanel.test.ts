import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ZonePanel from '../../../app/components/game/ZonePanel.vue'
import type { PlayerState, CreepState, TowerState } from '../../../shared/types/game'

// ── Helpers ───────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 500,
    maxHp: 550,
    mp: 200,
    maxMp: 280,
    level: 3,
    xp: 150,
    gold: 300,
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

function makeCreep(overrides: Partial<CreepState & { index: number }> = {}) {
  return {
    id: 'creep_1',
    team: 'dire' as const,
    zone: 'mid-river',
    hp: 300,
    type: 'melee' as const,
    index: 0,
    ...overrides,
  }
}

function makeTower(overrides: Partial<TowerState> = {}): TowerState {
  return {
    team: 'dire',
    zone: 'mid-river',
    hp: 1200,
    maxHp: 1500,
    alive: true,
    invulnerable: false,
    ...overrides,
  }
}

const baseProps = {
  zoneName: 'Mid River',
  playerTeam: 'radiant' as const,
}

// ── Tests ─────────────────────────────────────────────────────────

describe('ZonePanel', () => {
  describe('empty zone', () => {
    it('shows the empty message when no units are present', () => {
      const wrapper = mount(ZonePanel, { props: baseProps })

      expect(wrapper.find('[data-testid="zone-panel-empty"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Mid River')
    })
  })

  describe('enemy heroes', () => {
    it('renders name, level, and HP/MP values', () => {
      const enemy = makePlayer({
        id: 'e1',
        name: 'Enemy',
        heroId: 'daemon',
        team: 'dire',
        hp: 420,
        maxHp: 600,
        mp: 90,
        maxMp: 200,
        level: 7,
      })
      const wrapper = mount(ZonePanel, { props: { ...baseProps, enemies: [enemy] } })

      const row = wrapper.find('[data-testid="zone-enemy-e1"]')
      expect(row.exists()).toBe(true)
      expect(row.text()).toContain('Lv 7')
      expect(row.text()).toContain('420/600')
      expect(row.text()).toContain('90/200')
    })

    it('emits an attack command on click', async () => {
      const enemy = makePlayer({ id: 'e1', heroId: 'daemon', team: 'dire' })
      const wrapper = mount(ZonePanel, { props: { ...baseProps, enemies: [enemy] } })

      await wrapper.find('[data-testid="zone-enemy-e1"]').trigger('click')

      expect(wrapper.emitted('command')).toEqual([['attack hero:daemon']])
    })

    it('falls back to the player name when no hero is picked', async () => {
      const enemy = makePlayer({ id: 'e1', name: 'Anon', heroId: null, team: 'dire' })
      const wrapper = mount(ZonePanel, { props: { ...baseProps, enemies: [enemy] } })

      await wrapper.find('[data-testid="zone-enemy-e1"]').trigger('click')

      expect(wrapper.emitted('command')).toEqual([['attack hero:Anon']])
    })
  })

  describe('allied heroes', () => {
    it('renders ally rows without an attack action', async () => {
      const ally = makePlayer({ id: 'a1', heroId: 'echo', team: 'radiant', hp: 333, maxHp: 500 })
      const wrapper = mount(ZonePanel, { props: { ...baseProps, allies: [ally] } })

      const row = wrapper.find('[data-testid="zone-ally-a1"]')
      expect(row.exists()).toBe(true)
      expect(row.text()).toContain('333/500')
      expect(row.text()).toContain('ally')

      await row.trigger('click')
      expect(wrapper.emitted('command')).toBeUndefined()
    })
  })

  describe('creep groups', () => {
    it('shows enemy creep count and lowest HP', () => {
      const creeps = [
        makeCreep({ id: 'c1', hp: 300, index: 0 }),
        makeCreep({ id: 'c2', hp: 120, index: 2 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, creeps } })

      const group = wrapper.find('[data-testid="zone-creeps-enemy"]')
      expect(group.exists()).toBe(true)
      expect(group.text()).toContain('2× enemy creeps')
      expect(group.text()).toContain('lowest 120hp')
    })

    it('attacks the lowest-HP enemy creep by its visible index', async () => {
      const creeps = [
        makeCreep({ id: 'c1', hp: 300, index: 0 }),
        makeCreep({ id: 'c2', hp: 120, index: 2 }),
        makeCreep({ id: 'c3', hp: 250, index: 5 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, creeps } })

      await wrapper.find('[data-testid="zone-creeps-enemy"]').trigger('click')

      expect(wrapper.emitted('command')).toEqual([['attack creep:2']])
    })

    it('separates allied creeps into a non-attackable group', () => {
      const creeps = [
        makeCreep({ id: 'c1', team: 'radiant', hp: 90, index: 0 }),
        makeCreep({ id: 'c2', team: 'dire', hp: 300, index: 1 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, creeps } })

      const allyGroup = wrapper.find('[data-testid="zone-creeps-ally"]')
      expect(allyGroup.exists()).toBe(true)
      expect(allyGroup.text()).toContain('1× allied creep')
      expect(allyGroup.text()).toContain('lowest 90hp')
      // Allied group is informational, not a button
      expect(allyGroup.element.tagName).toBe('DIV')
    })

    it('ignores dead creeps', () => {
      const creeps = [makeCreep({ id: 'c1', hp: 0, index: 0 })]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, creeps } })

      expect(wrapper.find('[data-testid="zone-creeps-enemy"]').exists()).toBe(false)
    })
  })

  describe('tower', () => {
    it('renders an enemy tower as an attackable button with HP', async () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, tower: makeTower({ team: 'dire' }) },
      })

      const tower = wrapper.find('[data-testid="zone-tower"]')
      expect(tower.exists()).toBe(true)
      expect(tower.element.tagName).toBe('BUTTON')
      expect(tower.text()).toContain('1200/1500')

      await tower.trigger('click')
      expect(wrapper.emitted('command')).toEqual([['attack tower:mid-river']])
    })

    it('renders an allied tower as informational only', async () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, tower: makeTower({ team: 'radiant' }) },
      })

      const tower = wrapper.find('[data-testid="zone-tower"]')
      expect(tower.exists()).toBe(true)
      expect(tower.element.tagName).toBe('DIV')
      expect(tower.text()).toContain('allied')

      await tower.trigger('click')
      expect(wrapper.emitted('command')).toBeUndefined()
    })

    it('hides destroyed towers', () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, tower: makeTower({ alive: false }) },
      })

      expect(wrapper.find('[data-testid="zone-tower"]').exists()).toBe(false)
    })
  })

  describe('neutrals', () => {
    it('shows alive neutral count with lowest HP', () => {
      const neutrals = [
        { id: 'n1', zone: 'mid-river', hp: 250, maxHp: 250, type: 'kobold', alive: true },
        { id: 'n2', zone: 'mid-river', hp: 100, maxHp: 250, type: 'kobold', alive: true },
        { id: 'n3', zone: 'mid-river', hp: 0, maxHp: 250, type: 'kobold', alive: false },
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, neutrals } })

      const row = wrapper.find('[data-testid="zone-neutrals"]')
      expect(row.exists()).toBe(true)
      expect(row.text()).toContain('2× neutrals')
      expect(row.text()).toContain('lowest 100hp')
    })
  })
})
