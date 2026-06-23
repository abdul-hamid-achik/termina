import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HeroPicker from '../../../app/components/lobby/HeroPicker.vue'
import type { TeamId } from '../../../shared/types/game'

// Stubs for Nuxt auto-imported components
const AsciiButtonStub = {
  props: ['label', 'variant', 'disabled'],
  emits: ['click'],
  template: `<button :disabled="disabled" data-testid="ascii-button" @click="$emit('click')">{{ label }}</button>`,
}
const HeroAvatarStub = {
  props: ['heroId', 'size'],
  template: `<span data-testid="hero-avatar" />`,
}

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(HeroPicker, {
    props: {
      team: 'radiant' as TeamId,
      myPlayerId: 'me',
      ...props,
    },
    global: {
      stubs: {
        AsciiButton: AsciiButtonStub,
        HeroAvatar: HeroAvatarStub,
      },
    },
  })
}

const roster = [
  { playerId: 'me', name: 'Me', heroId: null, team: 'radiant' as TeamId },
  { playerId: 'p2', name: 'Ally', heroId: null, team: 'radiant' as TeamId },
  { playerId: 'e1', name: 'Enemy', heroId: null, team: 'dire' as TeamId },
]

describe('HeroPicker', () => {
  describe('turn gating', () => {
    it('disables CONFIRM when it is not my turn, even with a hero selected', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'p2', username: 'Ally' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeDefined()
      expect(wrapper.emitted('pick')).toBeUndefined()
    })

    it('enables CONFIRM on my turn with a hero selected and emits pick', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeUndefined()

      await btn.trigger('click')
      expect(wrapper.emitted('pick')).toEqual([['echo']])
    })

    it('selects a hero by keyboard (Enter) — the card is a focusable button', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      const card = wrapper.find('[data-testid="hero-card-echo"]')
      // exposed as a keyboard-operable control
      expect(card.attributes('role')).toBe('button')
      expect(card.attributes('tabindex')).toBe('0')

      await card.trigger('keydown.enter')
      expect(card.attributes('aria-pressed')).toBe('true')

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeUndefined()
      await btn.trigger('click')
      expect(wrapper.emitted('pick')).toEqual([['echo']])
    })

    it('does not emit pick when confirming out of turn', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'p2', username: 'Ally' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')
      // Force-trigger the click even though the button is disabled
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')

      expect(wrapper.emitted('pick')).toBeUndefined()
    })

    it('disables CONFIRM after my pick is registered', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: { me: 'echo' },
      })

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeDefined()
    })
  })

  describe('turn banner', () => {
    it('shows a prominent YOUR TURN banner on my turn', () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      const banner = wrapper.find('[data-testid="turn-banner"]')
      expect(banner.exists()).toBe(true)
      expect(banner.text()).toContain('YOUR TURN TO PICK')
    })

    it("shows who is picking when it is someone else's turn", () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'p2', username: 'Ally' },
      })

      const banner = wrapper.find('[data-testid="turn-banner"]')
      expect(banner.text()).toContain('waiting: Ally is picking')
    })

    it('renders no banner before the first pick_turn arrives', () => {
      const wrapper = mountPicker({ currentPicker: null })
      expect(wrapper.find('[data-testid="turn-banner"]').exists()).toBe(false)
    })
  })

  describe('error surface', () => {
    it('renders the inline error notice when errorMessage is set', () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        errorMessage: 'Not your turn to pick',
      })

      const err = wrapper.find('[data-testid="pick-error"]')
      expect(err.exists()).toBe(true)
      expect(err.text()).toContain('Not your turn to pick')
    })

    it('hides the error notice when there is no error', () => {
      const wrapper = mountPicker({})
      expect(wrapper.find('[data-testid="pick-error"]').exists()).toBe(false)
    })
  })

  describe('confirm reset (failed pick recovery)', () => {
    it('re-enables CONFIRM after an optimistic pick is rolled back', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: {},
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')
      expect(wrapper.emitted('pick')).toHaveLength(1)

      // Parent applies the optimistic pick…
      await wrapper.setProps({ pickedHeroes: { me: 'echo' } })
      expect(wrapper.find('[data-testid="ascii-button"]').attributes('disabled')).toBeDefined()

      // …then the server rejects it and the parent rolls it back
      await wrapper.setProps({ pickedHeroes: {} })

      expect(wrapper.find('[data-testid="ascii-button"]').attributes('disabled')).toBeUndefined()

      await wrapper.find('[data-testid="ascii-button"]').trigger('click')
      expect(wrapper.emitted('pick')).toHaveLength(2)
    })

    it('resets the confirm latch when the pick turn moves on', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')

      // Turn moves to someone else without my pick landing (rejected silently)
      await wrapper.setProps({ currentPicker: { playerId: 'p2', username: 'Ally' } })
      // Then it is my turn again
      await wrapper.setProps({ currentPicker: { playerId: 'me', username: 'Me' } })

      expect(wrapper.find('[data-testid="ascii-button"]').attributes('disabled')).toBeUndefined()
    })
  })

  describe('mobile roster strip', () => {
    it('renders a compact strip with one slot per player', () => {
      const wrapper = mountPicker({
        teamRoster: roster,
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      const strip = wrapper.find('[data-testid="roster-strip"]')
      expect(strip.exists()).toBe(true)
      // 5 radiant + 5 dire slots
      expect(strip.findAll('div').length).toBe(10)
      // Unpicked players show their initial
      expect(strip.text()).toContain('M')
    })
  })

  describe('hero selection', () => {
    it('does not select heroes that are already picked', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: { e1: 'echo' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeDefined()
    })
  })

  describe('hero detail panel (draft info)', () => {
    it('shows the selected hero passive + ability descriptions for informed drafting', async () => {
      const wrapper = mountPicker()
      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      // Passive: name + what it actually does (echo's Resonance)
      const passive = wrapper.find('[data-testid="picker-passive"]')
      expect(passive.exists()).toBe(true)
      expect(passive.text()).toContain('Resonance')
      expect(passive.text().toLowerCase()).toContain('consecutive')

      // Every ability shows a description, not just its name/MP/CD
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        const desc = wrapper.find(`[data-testid="picker-ability-desc-${slot}"]`)
        expect(desc.exists()).toBe(true)
        expect(desc.text().length).toBeGreaterThan(3)
      }
    })

    it('shows the select prompt and no passive panel before a hero is chosen', () => {
      const wrapper = mountPicker()
      expect(wrapper.find('[data-testid="picker-passive"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('select a hero')
    })

    it('shows kit-identity playstyle tags for the selected hero', async () => {
      const wrapper = mountPicker()
      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      const tags = wrapper.find('[data-testid="picker-playstyle"]')
      expect(tags.exists()).toBe(true)
      // echo is a burst carry — at least one tag, all from the known set.
      const chips = tags.findAll('span').map((s) => s.text())
      expect(chips.length).toBeGreaterThan(0)
      const known = ['Burst', 'Damage over time', 'Control', 'Sustain', 'Mobility']
      for (const c of chips) expect(known).toContain(c)
    })

    it('shows no playstyle tags before a hero is chosen', () => {
      const wrapper = mountPicker()
      expect(wrapper.find('[data-testid="picker-playstyle"]').exists()).toBe(false)
    })
  })
})
