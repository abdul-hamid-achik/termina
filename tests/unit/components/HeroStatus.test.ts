import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HeroStatus from '../../../app/components/game/HeroStatus.vue'
import { HEROES } from '../../../shared/constants/heroes'
import { mockPointer, restorePointer, tapOutside } from './helpers/pointer'

const HERO_ID = 'echo'
const Q_MANA_COST = HEROES[HERO_ID]!.abilities.q.manaCost

interface HeroOverrides {
  cooldowns?: { q: number; w: number; e: number; r: number }
  [key: string]: unknown
}

function makeHero(overrides: HeroOverrides = {}) {
  return {
    name: 'TestHero',
    level: 5,
    zone: 'mid-lane',
    hp: 500,
    maxHp: 600,
    mp: 300,
    maxMp: 400,
    cooldowns: { q: 0, w: 0, e: 3, r: 0 },
    items: [null, null, null, null, null, null],
    buffs: [],
    gold: 1000,
    alive: true,
    ...overrides,
  }
}

function mountHeroStatus(hero = makeHero()) {
  return mount(HeroStatus, {
    props: { hero, heroId: HERO_ID },
    attachTo: document.body,
    global: { stubs: { HeroAvatar: true, ProgressBar: true } },
  })
}

afterEach(() => {
  restorePointer()
  document.body.innerHTML = ''
})

describe('HeroStatus ability chips', () => {
  describe('fine pointer (desktop)', () => {
    it('casts immediately on click when off cooldown', async () => {
      mockPointer(false)
      const wrapper = mountHeroStatus()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toEqual([['q']])
      wrapper.unmount()
    })

    it('does not cast on click when on cooldown', async () => {
      mockPointer(false)
      const wrapper = mountHeroStatus()

      await wrapper.find('[data-testid="ability-chip-e"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toBeUndefined()
      wrapper.unmount()
    })

    it('shows tooltip on hover without a cast button', async () => {
      mockPointer(false)
      const wrapper = mountHeroStatus()

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
      const wrapper = mountHeroStatus()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toBeUndefined()
      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('tooltip contains an explicit [CAST] button with mana cost', async () => {
      mockPointer(true)
      const wrapper = mountHeroStatus()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')

      const castBtn = wrapper.find('[data-testid="ability-cast-q"]')
      expect(castBtn.exists()).toBe(true)
      expect(castBtn.text()).toContain('CAST Q')
      expect(castBtn.text()).toContain(`${Q_MANA_COST}mp`)
      wrapper.unmount()
    })

    it('tapping the [CAST] button casts and dismisses the tooltip', async () => {
      mockPointer(true)
      const wrapper = mountHeroStatus()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')
      await wrapper.find('[data-testid="ability-cast-q"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toEqual([['q']])
      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('tapping the chip again closes the tooltip without casting', async () => {
      mockPointer(true)
      const wrapper = mountHeroStatus()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')
      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')

      expect(wrapper.emitted('castAbility')).toBeUndefined()
      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('ability on cooldown shows tooltip with no cast button', async () => {
      mockPointer(true)
      const wrapper = mountHeroStatus()

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
      const wrapper = mountHeroStatus()

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
      const wrapper = mountHeroStatus()

      await wrapper.find('[data-testid="ability-chip-q"]').trigger('click')
      await wrapper.find('[data-testid="ability-chip-w"]').trigger('click')

      expect(wrapper.find('[data-testid="ability-tooltip-q"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="ability-tooltip-w"]').exists()).toBe(true)
      expect(wrapper.emitted('castAbility')).toBeUndefined()
      wrapper.unmount()
    })
  })
})

describe('HeroStatus buff strip', () => {
  it('renders readable labels, hides item-cooldown markers, and colours debuffs', () => {
    const wrapper = mountHeroStatus(
      makeHero({
        buffs: [
          { id: 'magic_immune', stacks: 1, ticksRemaining: 4 },
          { id: 'veil_discord', stacks: 25, ticksRemaining: 4 },
          { id: 'item_cd_black_king_bar', stacks: 1, ticksRemaining: 25 },
        ],
      }),
    )

    // Friendly label instead of the raw id.
    const bkb = wrapper.find('[data-testid="buff-magic_immune"]')
    expect(bkb.exists()).toBe(true)
    expect(bkb.text()).toContain('Magic Immune')
    expect(wrapper.text()).not.toContain('magic_immune')

    // The enemy debuff renders in the danger colour, not the generic buff colour.
    const veil = wrapper.find('[data-testid="buff-veil_discord"]')
    expect(veil.classes()).toContain('text-dire')

    // The item-cooldown bookkeeping marker never reaches the strip.
    expect(wrapper.find('[data-testid="buff-item_cd_black_king_bar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows no Buffs section when every effect is an internal marker', () => {
    const wrapper = mountHeroStatus(
      makeHero({ buffs: [{ id: 'item_cd_dagon', stacks: 1, ticksRemaining: 18 }] }),
    )
    expect(wrapper.text()).not.toContain('Buffs')
    wrapper.unmount()
  })

  it('colours a neutral buff with the ability colour and hides the countdown for permanent auras', () => {
    const wrapper = mountHeroStatus(
      makeHero({
        buffs: [
          { id: 'tp_channeling', stacks: 1, ticksRemaining: 3 }, // neutral → text-ability
          { id: 'power_treads_attack', stacks: 15, ticksRemaining: 999 }, // permanent → no countdown
        ],
      }),
    )
    const neutral = wrapper.find('[data-testid="buff-tp_channeling"]')
    expect(neutral.exists()).toBe(true)
    expect(neutral.classes()).toContain('text-ability')

    const treads = wrapper.find('[data-testid="buff-power_treads_attack"]')
    expect(treads.exists()).toBe(true)
    expect(treads.text()).not.toContain('999') // no misleading (999t) countdown
    wrapper.unmount()
  })
})

describe('HeroStatus dead state', () => {
  it('marks a dead hero with a [DEAD] tag', () => {
    const wrapper = mountHeroStatus(makeHero({ alive: false }))
    expect(wrapper.text()).toContain('[DEAD]')
    wrapper.unmount()
  })
})
