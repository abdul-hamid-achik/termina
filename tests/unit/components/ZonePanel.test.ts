import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ZonePanel from '~~/app/components/game/ZonePanel.vue'
import type { PlayerState, CreepState, NeutralCreepState, TowerState } from '~~/shared/types/game'

// ── Helpers ───────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'chaff',
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
    team: 'audit' as const,
    zone: 'mid-river',
    hp: 300,
    type: 'melee' as const,
    index: 0,
    ...overrides,
  }
}

function makeTower(overrides: Partial<TowerState> = {}): TowerState {
  return {
    team: 'audit',
    zone: 'mid-river',
    hp: 1200,
    maxHp: 1500,
    alive: true,
    invulnerable: false,
    ...overrides,
  }
}

function makeNeutral(overrides: Partial<NeutralCreepState & { index: number }> = {}) {
  return {
    id: 'neutral_1',
    zone: 'mid-river',
    hp: 250,
    maxHp: 250,
    type: 'kobold',
    alive: true,
    index: 0,
    ...overrides,
  }
}

const baseProps = {
  zoneName: 'Mid River',
  playerTeam: 'chaff' as const,
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
        team: 'audit',
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
      const enemy = makePlayer({ id: 'e1', heroId: 'daemon', team: 'audit' })
      const wrapper = mount(ZonePanel, { props: { ...baseProps, enemies: [enemy] } })

      await wrapper.find('[data-testid="zone-enemy-e1"]').trigger('click')

      expect(wrapper.emitted('command')).toEqual([['attack hero:daemon']])
    })

    it('falls back to the player name when no hero is picked', async () => {
      const enemy = makePlayer({ id: 'e1', name: 'Anon', heroId: null, team: 'audit' })
      const wrapper = mount(ZonePanel, { props: { ...baseProps, enemies: [enemy] } })

      await wrapper.find('[data-testid="zone-enemy-e1"]').trigger('click')

      expect(wrapper.emitted('command')).toEqual([['attack hero:Anon']])
    })
  })

  describe('allied heroes', () => {
    it('renders ally rows without an attack action', async () => {
      const ally = makePlayer({ id: 'a1', heroId: 'echo', team: 'chaff', hp: 333, maxHp: 500 })
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

    it('separates allied creeps into a group; a healthy one is informational only', () => {
      // 300hp melee (max 400) is above the 50% deny threshold → not denyable,
      // so the group stays a plain informational DIV.
      const creeps = [
        makeCreep({ id: 'c1', team: 'chaff', hp: 300, index: 0 }),
        makeCreep({ id: 'c2', team: 'audit', hp: 300, index: 1 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, creeps } })

      const allyGroup = wrapper.find('[data-testid="zone-creeps-ally"]')
      expect(allyGroup.exists()).toBe(true)
      expect(allyGroup.text()).toContain('1× allied creep')
      expect(allyGroup.text()).toContain('lowest 300hp')
      // Above the deny threshold → informational, not a button
      expect(allyGroup.element.tagName).toBe('DIV')
      expect(allyGroup.text()).not.toContain('[deny]')
    })

    it('offers a deny on an allied creep once it drops below 50% HP', async () => {
      // 150hp melee (max 400) is below the 200hp deny threshold → denyable.
      const creeps = [makeCreep({ id: 'c1', team: 'chaff', hp: 150, index: 4 })]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, creeps } })

      const allyGroup = wrapper.find('[data-testid="zone-creeps-ally"]')
      expect(allyGroup.element.tagName).toBe('BUTTON')
      expect(allyGroup.text()).toContain('[deny]')

      await allyGroup.trigger('click')
      expect(wrapper.emitted('command')).toEqual([['deny creep:4']])
    })

    it('denies the lowest-HP eligible allied creep by its visible index', async () => {
      // Two denyable allied creeps; the lower-HP one (index 7) is the target.
      const creeps = [
        makeCreep({ id: 'c1', team: 'chaff', hp: 180, index: 3 }),
        makeCreep({ id: 'c2', team: 'chaff', hp: 60, index: 7 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, creeps } })

      await wrapper.find('[data-testid="zone-creeps-ally"]').trigger('click')
      expect(wrapper.emitted('command')).toEqual([['deny creep:7']])
    })

    it('respects per-type max HP for the deny threshold (ranged creep)', async () => {
      // Ranged max is 250 → threshold 125. A 130hp ranged creep is NOT denyable;
      // a 200hp melee (max 400, threshold 200) IS. Only the melee should arm.
      const creeps = [makeCreep({ id: 'c1', team: 'chaff', hp: 130, type: 'ranged', index: 0 })]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, creeps } })

      const allyGroup = wrapper.find('[data-testid="zone-creeps-ally"]')
      expect(allyGroup.element.tagName).toBe('DIV')
      expect(allyGroup.text()).not.toContain('[deny]')
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
        props: { ...baseProps, tower: makeTower({ team: 'audit' }) },
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
        props: { ...baseProps, tower: makeTower({ team: 'chaff' }) },
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

    it('paints a tower in ITS team colour, not in "mine vs theirs"', () => {
      // The row prints the team name — "Tower (audit)" in the Chaff green was
      // the label and its colour contradicting each other inside one span, and
      // it disagreed with the ▼ the map draws for the same tower.
      const audit = mount(ZonePanel, {
        props: { ...baseProps, playerTeam: 'audit' as const, tower: makeTower({ team: 'audit' }) },
      })
      const towerLabel = audit.find('[data-testid="zone-tower"] span')
      expect(towerLabel.text()).toContain('audit')
      expect(towerLabel.classes()).toContain('text-audit')
      expect(towerLabel.classes()).not.toContain('text-chaff')

      const chaff = mount(ZonePanel, {
        props: { ...baseProps, playerTeam: 'audit' as const, tower: makeTower({ team: 'chaff' }) },
      })
      expect(chaff.find('[data-testid="zone-tower"] span').classes()).toContain('text-chaff')
    })

    it('paints the zone identity tag by the zone owner, matching the map', () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, playerTeam: 'audit' as const, zoneId: 'audit-base' },
      })
      const tag = wrapper.find('[data-testid="zone-status"] span')
      expect(tag.text()).toContain('ours')
      expect(tag.classes()).toContain('text-audit')
    })
  })

  describe('status header', () => {
    it('reports CLEAR with no enemies present', () => {
      const wrapper = mount(ZonePanel, { props: { ...baseProps, zoneId: 'mid-river' } })
      expect(wrapper.find('[data-testid="zone-threat"]').text()).toBe('CLEAR')
    })

    it('reports CONTESTED when enemies match the allied headcount (incl. self)', () => {
      const enemy = makePlayer({ id: 'e1', team: 'audit' })
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, zoneId: 'mid-river', enemies: [enemy] },
      })
      expect(wrapper.find('[data-testid="zone-threat"]').text()).toBe('CONTESTED')
    })

    it('reports DANGER when enemies outnumber allies', () => {
      const enemies = [
        makePlayer({ id: 'e1', team: 'audit' }),
        makePlayer({ id: 'e2', team: 'audit' }),
      ]
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, zoneId: 'mid-river', enemies },
      })
      expect(wrapper.find('[data-testid="zone-threat"]').text()).toBe('DANGER')
    })

    it('shows a zone-local objective for a river zone', () => {
      const wrapper = mount(ZonePanel, { props: { ...baseProps, zoneId: 'mid-river' } })
      expect(wrapper.find('[data-testid="zone-objective"]').text()).toContain('Contest runes')
    })

    it('prioritises destroying an enemy tower as the objective', () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, zoneId: 'mid-t1-audit', tower: makeTower({ team: 'audit' }) },
      })
      expect(wrapper.find('[data-testid="zone-objective"]').text()).toContain('enemy tower')
    })

    it('tells a laner to push when they have creep support', () => {
      const creeps = [makeCreep({ id: 'c1', team: 'chaff', hp: 200, index: 0 })]
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, zoneId: 'mid-t1-rad', creeps },
      })
      expect(wrapper.find('[data-testid="zone-objective"]').text()).toContain(
        'Push with your creeps',
      )
    })
  })

  describe('neutrals', () => {
    it('shows alive neutral count with lowest HP', () => {
      const neutrals = [
        makeNeutral({ id: 'n1', hp: 250, index: 4 }),
        makeNeutral({ id: 'n2', hp: 100, index: 5 }),
        makeNeutral({ id: 'n3', hp: 0, alive: false, index: 6 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, neutrals } })

      const row = wrapper.find('[data-testid="zone-neutrals"]')
      expect(row.exists()).toBe(true)
      expect(row.text()).toContain('2× neutrals')
      expect(row.text()).toContain('lowest 100hp')
    })

    // The index carried on each neutral is its position in the GLOBAL neutrals
    // array, not among the in-zone survivors — emitting a re-derived 0/1/2 here
    // would attack a camp in a completely different jungle.
    it('emits an attack on the lowest-HP camp member using its global index', async () => {
      const neutrals = [
        makeNeutral({ id: 'n1', hp: 250, index: 4 }),
        makeNeutral({ id: 'n2', hp: 100, index: 5 }),
        makeNeutral({ id: 'n3', hp: 20, alive: false, index: 6 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, neutrals } })

      await wrapper.find('[data-testid="zone-neutrals"]').trigger('click')

      expect(wrapper.emitted('command')).toEqual([['attack neutral:5']])
    })
  })

  describe('roshan', () => {
    it('renders no Roshan row when he is not passed (outside the pit)', () => {
      const wrapper = mount(ZonePanel, { props: { ...baseProps, zoneId: 'mid-river' } })

      expect(wrapper.find('[data-testid="zone-roshan"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="zone-panel-empty"]').exists()).toBe(true)
    })

    it('renders a Roshan row with HP and emits attack roshan on click', async () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          zoneId: 'roshan-pit',
          roshan: { alive: true, hp: 3200, maxHp: 5000, deathTick: null },
        },
      })

      const row = wrapper.find('[data-testid="zone-roshan"]')
      expect(row.exists()).toBe(true)
      expect(row.text()).toContain('3200/5000')
      // A pit holding Roshan is not an empty zone.
      expect(wrapper.find('[data-testid="zone-panel-empty"]').exists()).toBe(false)

      await row.trigger('click')
      expect(wrapper.emitted('command')).toEqual([['attack roshan']])
    })

    it('hides the row once Roshan is dead', () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          zoneId: 'roshan-pit',
          roshan: { alive: false, hp: 0, maxHp: 5000, deathTick: 120 },
        },
      })

      expect(wrapper.find('[data-testid="zone-roshan"]').exists()).toBe(false)
    })
  })

  // A standing order re-swings every tick with no input, so the row it belongs
  // to has to say so — otherwise repeat damage lines look like a bug.
  describe('standing attack order', () => {
    const enemyTower = makeTower({ team: 'audit', zone: 'mid-river' })

    it('marks the tower row [hold] while it is the standing target', () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          tower: enemyTower,
          attackTarget: { kind: 'tower' as const, zone: 'mid-river' },
        },
      })

      expect(wrapper.find('[data-testid="zone-tower-tag"]').text()).toBe('[hold]')
    })

    it('leaves the tower row [ATK] when the order names a different tower', () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          tower: enemyTower,
          attackTarget: { kind: 'tower' as const, zone: 'top-t1-audit' },
        },
      })

      expect(wrapper.find('[data-testid="zone-tower-tag"]').text()).toBe('[ATK]')
    })

    it('marks the Roshan row [hold]', () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          zoneId: 'roshan-pit',
          roshan: { alive: true, hp: 3200, maxHp: 5000, deathTick: null },
          attackTarget: { kind: 'roshan' as const },
        },
      })

      expect(wrapper.find('[data-testid="zone-roshan-tag"]').text()).toContain('[hold]')
    })

    it('marks the held enemy hero, resolving the order by heroId like the server', () => {
      const held = makePlayer({ id: 'e1', name: 'Enemy', heroId: 'daemon', team: 'audit' })
      const other = makePlayer({ id: 'e2', name: 'Other', heroId: 'cache', team: 'audit' })
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          enemies: [held, other],
          attackTarget: { kind: 'hero' as const, name: 'daemon' },
        },
      })

      expect(wrapper.find('[data-testid="zone-enemy-tag-e1"]').text()).toContain('[hold]')
      expect(wrapper.find('[data-testid="zone-enemy-tag-e2"]').text()).toContain('[ATK]')
    })

    it('shows no hold anywhere without a standing order (the default)', () => {
      const enemy = makePlayer({ id: 'e1', heroId: 'daemon', team: 'audit' })
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, enemies: [enemy], tower: enemyTower },
      })

      expect(wrapper.text()).not.toContain('[hold]')
    })
  })
})
