import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ZonePanel from '~~/app/components/game/ZonePanel.vue'
import type { PlayerState, WaveUnitState, NeutralUnitState, IceState } from '~~/shared/types/game'

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
    iceDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeWave(overrides: Partial<WaveUnitState & { index: number }> = {}) {
  return {
    id: 'creep_1',
    team: 'audit' as const,
    zone: 'mid-river',
    hp: 300,
    type: 'line' as const,
    index: 0,
    ...overrides,
  }
}

function makeIce(overrides: Partial<IceState> = {}): IceState {
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

function makeNeutral(overrides: Partial<NeutralUnitState & { index: number }> = {}) {
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

  describe('wave groups', () => {
    it('shows enemy wave count and lowest HP', () => {
      const waves = [
        makeWave({ id: 'c1', hp: 300, index: 0 }),
        makeWave({ id: 'c2', hp: 120, index: 2 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, waves } })

      const group = wrapper.find('[data-testid="zone-waves-enemy"]')
      expect(group.exists()).toBe(true)
      expect(group.text()).toContain('2× enemy waves')
      expect(group.text()).toContain('lowest 120hp')
    })

    it('attacks the lowest-HP enemy wave by its visible index', async () => {
      const waves = [
        makeWave({ id: 'c1', hp: 300, index: 0 }),
        makeWave({ id: 'c2', hp: 120, index: 2 }),
        makeWave({ id: 'c3', hp: 250, index: 5 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, waves } })

      await wrapper.find('[data-testid="zone-waves-enemy"]').trigger('click')

      expect(wrapper.emitted('command')).toEqual([['attack wave:2']])
    })

    it('separates allied waves into a group; a healthy one is informational only', () => {
      // 300hp line (max 400) is above the 50% burn threshold → not denyable,
      // so the group stays a plain informational DIV.
      const waves = [
        makeWave({ id: 'c1', team: 'chaff', hp: 300, index: 0 }),
        makeWave({ id: 'c2', team: 'audit', hp: 300, index: 1 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, waves } })

      const allyGroup = wrapper.find('[data-testid="zone-waves-ally"]')
      expect(allyGroup.exists()).toBe(true)
      expect(allyGroup.text()).toContain('1× allied wave')
      expect(allyGroup.text()).toContain('lowest 300hp')
      // Above the burn threshold → informational, not a button
      expect(allyGroup.element.tagName).toBe('DIV')
      expect(allyGroup.text()).not.toContain('[burn]')
    })

    it('offers a burn on an allied wave once it drops below 50% HP', async () => {
      // 150hp line (max 400) is below the 200hp burn threshold → denyable.
      const waves = [makeWave({ id: 'c1', team: 'chaff', hp: 150, index: 4 })]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, waves } })

      const allyGroup = wrapper.find('[data-testid="zone-waves-ally"]')
      expect(allyGroup.element.tagName).toBe('BUTTON')
      expect(allyGroup.text()).toContain('[burn]')

      await allyGroup.trigger('click')
      expect(wrapper.emitted('command')).toEqual([['burn wave:4']])
    })

    it('burns the lowest-HP eligible allied wave by its visible index', async () => {
      // Two denyable allied waves; the lower-HP one (index 7) is the target.
      const waves = [
        makeWave({ id: 'c1', team: 'chaff', hp: 180, index: 3 }),
        makeWave({ id: 'c2', team: 'chaff', hp: 60, index: 7 }),
      ]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, waves } })

      await wrapper.find('[data-testid="zone-waves-ally"]').trigger('click')
      expect(wrapper.emitted('command')).toEqual([['burn wave:7']])
    })

    it('respects per-type max HP for the burn threshold (sweep wave)', async () => {
      // Sweep max is 250 → threshold 125. A 130hp sweep wave is NOT denyable;
      // a 200hp line (max 400, threshold 200) IS. Only the line should arm.
      const waves = [makeWave({ id: 'c1', team: 'chaff', hp: 130, type: 'sweep', index: 0 })]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, waves } })

      const allyGroup = wrapper.find('[data-testid="zone-waves-ally"]')
      expect(allyGroup.element.tagName).toBe('DIV')
      expect(allyGroup.text()).not.toContain('[burn]')
    })

    it('ignores dead waves', () => {
      const waves = [makeWave({ id: 'c1', hp: 0, index: 0 })]
      const wrapper = mount(ZonePanel, { props: { ...baseProps, waves } })

      expect(wrapper.find('[data-testid="zone-waves-enemy"]').exists()).toBe(false)
    })
  })

  describe('ice', () => {
    it('renders an enemy ice as an attackable button with HP', async () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, ice: makeIce({ team: 'audit' }) },
      })

      const ice = wrapper.find('[data-testid="zone-ice"]')
      expect(ice.exists()).toBe(true)
      expect(ice.element.tagName).toBe('BUTTON')
      expect(ice.text()).toContain('1200/1500')

      await ice.trigger('click')
      expect(wrapper.emitted('command')).toEqual([['attack ice:mid-river']])
    })

    it('renders an allied ice as informational only', async () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, ice: makeIce({ team: 'chaff' }) },
      })

      const ice = wrapper.find('[data-testid="zone-ice"]')
      expect(ice.exists()).toBe(true)
      expect(ice.element.tagName).toBe('DIV')
      expect(ice.text()).toContain('allied')

      await ice.trigger('click')
      expect(wrapper.emitted('command')).toBeUndefined()
    })

    it('hides destroyed ice', () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, ice: makeIce({ alive: false }) },
      })

      expect(wrapper.find('[data-testid="zone-ice"]').exists()).toBe(false)
    })

    it('paints a ice in ITS team colour, not in "mine vs theirs"', () => {
      // The row prints the team name — "Ice (audit)" in the Chaff green was
      // the label and its colour contradicting each other inside one span, and
      // it disagreed with the ▼ the map draws for the same ice.
      const audit = mount(ZonePanel, {
        props: { ...baseProps, playerTeam: 'audit' as const, ice: makeIce({ team: 'audit' }) },
      })
      const iceLabel = audit.find('[data-testid="zone-ice"] span')
      expect(iceLabel.text()).toContain('audit')
      expect(iceLabel.classes()).toContain('text-audit')
      expect(iceLabel.classes()).not.toContain('text-chaff')

      const chaff = mount(ZonePanel, {
        props: { ...baseProps, playerTeam: 'audit' as const, ice: makeIce({ team: 'chaff' }) },
      })
      expect(chaff.find('[data-testid="zone-ice"] span').classes()).toContain('text-chaff')
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
      expect(wrapper.find('[data-testid="zone-objective"]').text()).toContain('Contest caches')
    })

    it('prioritises destroying an enemy ice as the objective', () => {
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, zoneId: 'mid-t1-audit', ice: makeIce({ team: 'audit' }) },
      })
      expect(wrapper.find('[data-testid="zone-objective"]').text()).toContain('enemy ice')
    })

    it('tells a laner to push when they have wave support', () => {
      const waves = [makeWave({ id: 'c1', team: 'chaff', hp: 200, index: 0 })]
      const wrapper = mount(ZonePanel, {
        props: { ...baseProps, zoneId: 'mid-t1-chaff', waves },
      })
      expect(wrapper.find('[data-testid="zone-objective"]').text()).toContain(
        'Push with your waves',
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

  describe('tenant', () => {
    it('renders no Tenant row when he is not passed (outside the pit)', () => {
      const wrapper = mount(ZonePanel, { props: { ...baseProps, zoneId: 'mid-river' } })

      expect(wrapper.find('[data-testid="zone-tenant"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="zone-panel-empty"]').exists()).toBe(true)
    })

    it('renders a Tenant row with HP and emits attack tenant on click', async () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          zoneId: 'hollow',
          tenant: { alive: true, hp: 3200, maxHp: 5000, deathTick: null },
        },
      })

      const row = wrapper.find('[data-testid="zone-tenant"]')
      expect(row.exists()).toBe(true)
      expect(row.text()).toContain('3200/5000')
      // A pit holding Tenant is not an empty zone.
      expect(wrapper.find('[data-testid="zone-panel-empty"]').exists()).toBe(false)

      await row.trigger('click')
      expect(wrapper.emitted('command')).toEqual([['attack tenant']])
    })

    it('hides the row once Tenant is dead', () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          zoneId: 'hollow',
          tenant: { alive: false, hp: 0, maxHp: 5000, deathTick: 120 },
        },
      })

      expect(wrapper.find('[data-testid="zone-tenant"]').exists()).toBe(false)
    })
  })

  // A standing order re-swings every tick with no input, so the row it belongs
  // to has to say so — otherwise repeat damage lines look like a bug.
  describe('standing attack order', () => {
    const enemyIce = makeIce({ team: 'audit', zone: 'mid-river' })

    it('marks the ice row [hold] while it is the standing target', () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          ice: enemyIce,
          attackTarget: { kind: 'ice' as const, zone: 'mid-river' },
        },
      })

      expect(wrapper.find('[data-testid="zone-ice-tag"]').text()).toBe('[hold]')
    })

    it('leaves the ice row [ATK] when the order names a different ice', () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          ice: enemyIce,
          attackTarget: { kind: 'ice' as const, zone: 'top-t1-audit' },
        },
      })

      expect(wrapper.find('[data-testid="zone-ice-tag"]').text()).toBe('[ATK]')
    })

    it('marks the Tenant row [hold]', () => {
      const wrapper = mount(ZonePanel, {
        props: {
          ...baseProps,
          zoneId: 'hollow',
          tenant: { alive: true, hp: 3200, maxHp: 5000, deathTick: null },
          attackTarget: { kind: 'tenant' as const },
        },
      })

      expect(wrapper.find('[data-testid="zone-tenant-tag"]').text()).toContain('[hold]')
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
        props: { ...baseProps, enemies: [enemy], ice: enemyIce },
      })

      expect(wrapper.text()).not.toContain('[hold]')
    })
  })
})
