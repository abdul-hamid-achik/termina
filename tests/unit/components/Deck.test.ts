import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Deck from '~~/app/components/game/Deck.vue'
import { HEROES } from '~~/shared/constants/heroes'
import { mockPointer, restorePointer, tapOutside } from './helpers/pointer'

const HERO_ID = 'echo'
// Echo Q costs [40, 50, 60, 70] across its four ranks; the fixture hero is
// level 5, which is rank 3. The panel used to quote the registry's flat
// rank-1 `bwCost` at every level — the number the engine stopped charging
// the moment the ability ranked up.
const Q_BW_BY_RANK = HEROES[HERO_ID]!.abilities.q.bwCostByLevel!
const Q_BW_COST = Q_BW_BY_RANK[2]!

interface HeroOverrides {
  cooldowns?: { q: number; w: number; e: number; r: number }
  [key: string]: unknown
}

function makeHero(overrides: HeroOverrides = {}) {
  return {
    name: 'TestHero',
    level: 5,
    zone: 'mid-lane',
    integ: 500,
    maxInteg: 600,
    bw: 300,
    maxBw: 400,
    cooldowns: { q: 0, w: 0, e: 3, r: 0 },
    items: [null, null, null, null, null, null],
    buffs: [],
    scrip: 1000,
    alive: true,
    ...overrides,
  }
}

function mountDeck(hero = makeHero()) {
  return mount(Deck, {
    props: { hero, heroId: HERO_ID },
    attachTo: document.body,
    global: { stubs: { HeroPortrait: true, ProgressBar: true } },
  })
}

afterEach(() => {
  restorePointer()
  document.body.innerHTML = ''
})

describe('Deck ability chips', () => {
  describe('fine pointer (desktop)', () => {
    it('casts immediately on click when off cooldown', async () => {
      mockPointer(false)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toEqual([['q']])
      wrapper.unmount()
    })

    it('hides ability chips and item slots in compact (cut HUD) mode', () => {
      const wrapper = mount(Deck, {
        props: { hero: makeHero(), heroId: HERO_ID, compact: true },
        attachTo: document.body,
        global: { stubs: { HeroPortrait: true, ProgressBar: true } },
      })
      expect(wrapper.find('[data-testid="ability-chip-q"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('[empty]')
      expect(wrapper.text()).toContain('INTEG')
      expect(wrapper.text()).toContain('Lv.5')
      expect(wrapper.text()).toContain('@ mid-lane')
      wrapper.unmount()
    })

    it('does not paint READY or emit a cast when the tutorial still locks cast', async () => {
      mockPointer(false)
      const wrapper = mount(Deck, {
        props: { hero: makeHero(), heroId: HERO_ID, castsLocked: true },
        attachTo: document.body,
        global: { stubs: { HeroPortrait: true, ProgressBar: true } },
      })
      const q = wrapper.find('[data-testid="ability-chip-q"]')
      expect(q.text()).toContain('—')
      expect(q.text()).not.toContain('RDY')
      await q.trigger('click')
      expect(wrapper.emitted('castAbility')).toBeUndefined()
      wrapper.unmount()
    })

    it('does not cast on click when on cooldown', async () => {
      mockPointer(false)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-e"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toBeUndefined()
      wrapper.unmount()
    })

    it('shows tooltip on hover without a cast button', async () => {
      mockPointer(false)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('mouseenter')

      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="ability-cast-q"]').exists()).toBe(false)

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('mouseleave')
      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(false)
      wrapper.unmount()
    })
  })

  describe('coarse pointer (touch)', () => {
    it('first tap opens the tooltip instead of casting', async () => {
      mockPointer(true)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toBeUndefined()
      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('tooltip contains an explicit [CAST] button with BW cost', async () => {
      mockPointer(true)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')

      const castBtn = wrapper.find('[data-testid="ability-cast-q"]')
      expect(castBtn.exists()).toBe(true)
      expect(castBtn.text()).toContain('CAST Q')
      expect(castBtn.text()).toContain(`${Q_BW_COST}bw`)
      wrapper.unmount()
    })

    it('tapping the [CAST] button casts and dismisses the tooltip', async () => {
      mockPointer(true)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')
      await wrapper.find('[data-testid="ability-cast-q"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toEqual([['q']])
      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('tapping the chip again closes the tooltip without casting', async () => {
      mockPointer(true)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')
      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toBeUndefined()
      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('ability on cooldown shows tooltip with no cast button', async () => {
      mockPointer(true)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-e"]').trigger('click')

      const tooltip = wrapper.find('[data-testid="ability-tooltip-e"]')
      expect(tooltip.exists()).toBe(true)
      expect(tooltip.text()).toContain('ON COOLDOWN')
      expect(wrapper.find('[data-testid="ability-cast-e"]').exists()).toBe(false)
      expect(wrapper.emitted('castAbility')).toBeUndefined()
      wrapper.unmount()
    })

    it('tap outside dismisses the tooltip', async () => {
      mockPointer(true)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')
      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(true)

      tapOutside()
      await nextTick()

      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(false)
      expect(wrapper.emitted('castAbility')).toBeUndefined()
      wrapper.unmount()
    })

    it('tapping a different chip switches the tooltip', async () => {
      mockPointer(true)
      const wrapper = mountDeck()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')
      await wrapper.find('[data-testid="ability-chip-w"]').trigger('click')

      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="ability-tooltip-w"]').exists()).toBe(true)
      expect(wrapper.emitted('castAbility')).toBeUndefined()
      wrapper.unmount()
    })
  })
})

describe('Deck cooldown readability', () => {
  it('spells a sub-minute ability cooldown out in seconds', async () => {
    mockPointer(false)
    const wrapper = mountDeck()

    await wrapper.find('[data-testid="ability-chip-q"]').trigger('mouseenter')

    const cd = HEROES[HERO_ID]!.abilities.q.cooldownCycles
    expect(wrapper.find('[data-testid="ability-tooltip-q"]').text()).toContain(
      `${cd}c (${cd * 4}s)`,
    )
    wrapper.unmount()
  })

  it('renders a minute-plus ultimate cooldown as a clock', async () => {
    mockPointer(false)
    const wrapper = mountDeck()

    await wrapper.find('[data-testid="ability-chip-r"]').trigger('mouseenter')

    // Echo's ultimate is 50 ticks — a number nobody can convert mid-fight.
    const tooltip = wrapper.find('[data-testid="ability-tooltip-r"]')
    expect(tooltip.text()).toContain('3:20')
    expect(tooltip.text()).not.toContain('50t')
    wrapper.unmount()
  })

  it('shows the remaining cooldown in seconds on the touch cast panel', async () => {
    mockPointer(true)
    const wrapper = mountDeck()

    await wrapper.find('[data-testid="ability-chip-e"]').trigger('click')

    // The fixture has E on a 3-tick cooldown.
    expect(wrapper.find('[data-testid="ability-tooltip-e"]').text()).toContain('3c (12s)')
    wrapper.unmount()
  })

  it('leaves the chip itself a bare tick count', () => {
    // Deliberate restraint: the chips are the dense part of the HUD, so the
    // seconds live in the tooltip and never widen the row.
    mockPointer(false)
    const wrapper = mountDeck()

    const chip = wrapper.find('[data-testid="ability-chip-e"]')
    expect(chip.text()).toContain('[3]')
    expect(chip.text()).not.toContain('12s')
    wrapper.unmount()
  })
})

describe('Deck buff strip', () => {
  it('renders readable labels, hides item-cooldown markers, and colours debuffs', () => {
    const wrapper = mountDeck(
      makeHero({
        buffs: [
          { id: 'airgap', stacks: 1, cyclesRemaining: 4 },
          { id: 'veil_discord', stacks: 25, cyclesRemaining: 4 },
          { id: 'item_cd_hardshell', stacks: 1, cyclesRemaining: 25 },
        ],
      }),
    )

    // Friendly label instead of the raw id.
    const bkb = wrapper.find('[data-testid="buff-airgap"]')
    expect(bkb.exists()).toBe(true)
    expect(bkb.text()).toContain('AIRGAP')
    expect(wrapper.text()).not.toContain('airgap')

    // The enemy debuff renders in the danger colour, not the generic buff colour.
    const veil = wrapper.find('[data-testid="buff-veil_discord"]')
    expect(veil.classes()).toContain('text-audit')

    // The item-cooldown bookkeeping marker never reaches the strip.
    expect(wrapper.find('[data-testid="buff-item_cd_hardshell"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows no Buffs section when every effect is an internal marker', () => {
    const wrapper = mountDeck(
      makeHero({ buffs: [{ id: 'item_cd_dagon', stacks: 1, cyclesRemaining: 18 }] }),
    )
    expect(wrapper.text()).not.toContain('Buffs')
    wrapper.unmount()
  })

  it('colours a neutral buff with the ability colour and hides the countdown for permanent auras', () => {
    const wrapper = mountDeck(
      makeHero({
        buffs: [
          { id: 'tp_channeling', stacks: 1, cyclesRemaining: 3 }, // neutral → text-ability
          { id: 'gait_rig_attack', stacks: 15, cyclesRemaining: 999 }, // permanent → no countdown
        ],
      }),
    )
    const neutral = wrapper.find('[data-testid="buff-tp_channeling"]')
    expect(neutral.exists()).toBe(true)
    expect(neutral.classes()).toContain('text-ability')

    const treads = wrapper.find('[data-testid="buff-gait_rig_attack"]')
    expect(treads.exists()).toBe(true)
    expect(treads.text()).not.toContain('999') // no misleading (999t) countdown
    wrapper.unmount()
  })
})

describe('Deck ability BW cost', () => {
  const tooltipText = async (level: number) => {
    mockPointer(false)
    const wrapper = mountDeck(makeHero({ level }))
    await wrapper.find('[data-testid="ability-chip-q"]').trigger('mouseenter')
    const text = wrapper.find('[data-testid="ability-tooltip-q"]').text()
    wrapper.unmount()
    return text
  }

  it('quotes the rank cost, which climbs with the hero level', async () => {
    // Literal numbers on purpose: deriving them from the same helper the
    // component uses would pass even if both agreed on the wrong rank.
    expect(await tooltipText(1)).toContain('BW: 40')
    expect(await tooltipText(3)).toContain('BW: 50')
    expect(await tooltipText(7)).toContain('BW: 70')
  })

  it('holds the cost flat across levels inside one rank', async () => {
    expect(await tooltipText(3)).toContain('BW: 50')
    expect(await tooltipText(4)).toContain('BW: 50')
  })

  it('prints the cast button cost in bw, not mp (R4-07)', async () => {
    mockPointer(true)
    const wrapper = mountDeck(makeHero({ level: 1 }))
    await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')
    const cast = wrapper.find('[data-testid="ability-cast-q"]')
    expect(cast.exists()).toBe(true)
    // Rank-1 Echo Q is 40 BW; unit is bw, never mp.
    expect(cast.text()).toMatch(/CAST Q — 40bw/)
    expect(cast.text()).not.toMatch(/mp/i)
    wrapper.unmount()
  })
})

describe('Deck dead state', () => {
  it('marks a dead hero with a [DEAD] tag', () => {
    const wrapper = mountDeck(makeHero({ alive: false }))
    expect(wrapper.text()).toContain('[DEAD]')
    wrapper.unmount()
  })
})
