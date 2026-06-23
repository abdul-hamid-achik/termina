import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AbilitySlot from '../../../app/components/heroes/AbilitySlot.vue'
import { formatEffect, cooldownSeconds } from '../../../shared/abilityFormat'
import { TICK_DURATION_MS } from '../../../shared/constants/balance'
import type { AbilityDef } from '../../../shared/types/hero'

// A representative targeted nuke with two effects, a mana cost and a cooldown —
// exercises every conditional branch the slot renders.
const ability: AbilityDef = {
  id: 'test_q',
  name: 'Packet Storm',
  description: 'Hurls a burst of packets at the target.',
  manaCost: 50,
  cooldownTicks: 3,
  targetType: 'hero',
  effects: [
    { type: 'damage', value: 40, damageType: 'magical' },
    { type: 'slow', value: 30, duration: 2 },
  ],
}

function mountSlot(props: Record<string, unknown> = {}) {
  return mount(AbilitySlot, { props: { slotKey: 'Q', ability, ...props } })
}

describe('AbilitySlot', () => {
  it('renders the kit (name, effects, description, costs, target) as a non-interactive div', () => {
    const wrapper = mountSlot()

    // Non-interactive => rendered as a plain <div>, not a <button>.
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.attributes('data-testid')).toBe('ability-q')

    const text = wrapper.text()
    expect(text).toContain('Q')
    expect(text).toContain('Packet Storm')
    expect(text).toContain('Hurls a burst of packets at the target.')
    // effects are formatted through the shared helper — assert the wiring, not a literal
    expect(text).toContain(formatEffect(ability.effects[0]!)) // "40 magical dmg"
    expect(text).toContain(formatEffect(ability.effects[1]!)) // "30% slow for 2t"
    // costs + target line
    expect(text).toContain('50') // mana cost
    expect(text).toContain(`${cooldownSeconds(ability, TICK_DURATION_MS)}s`) // cooldown in seconds
    expect(text).toContain('hero') // targetType (CSS uppercases it visually)
  })

  it('renders as a clickable button and emits cast when interactive + ready', async () => {
    const wrapper = mountSlot({ interactive: true, manaAvailable: 100 })

    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()

    await wrapper.trigger('click')
    expect(wrapper.emitted('cast')).toHaveLength(1)
  })

  it('does not emit cast when non-interactive, even if clicked', async () => {
    const wrapper = mountSlot()

    await wrapper.trigger('click')
    expect(wrapper.emitted('cast')).toBeUndefined()
  })

  describe('on cooldown', () => {
    it('shows the remaining cooldown, disables the button and blocks casting', async () => {
      const wrapper = mountSlot({ interactive: true, manaAvailable: 100, cooldownRemaining: 2 })

      expect(wrapper.text()).toContain('CD 2t')
      expect(wrapper.find('button').attributes('disabled')).toBeDefined()
      expect(wrapper.classes()).toContain('opacity-50')

      await wrapper.trigger('click')
      expect(wrapper.emitted('cast')).toBeUndefined()
    })
  })

  describe('unaffordable', () => {
    it('shows "no mp", disables the button and blocks casting', async () => {
      const wrapper = mountSlot({ interactive: true, manaAvailable: 10 }) // < manaCost 50

      expect(wrapper.text()).toContain('no mp')
      expect(wrapper.find('button').attributes('disabled')).toBeDefined()

      await wrapper.trigger('click')
      expect(wrapper.emitted('cast')).toBeUndefined()
    })
  })

  it('hides the mana + cooldown lines for a zero-cost passive-style ability', () => {
    const passive: AbilityDef = {
      id: 'test_passive',
      name: 'Always On',
      description: 'A static passive bonus.',
      manaCost: 0,
      cooldownTicks: 0,
      targetType: 'self',
      effects: [],
    }
    const wrapper = mount(AbilitySlot, { props: { slotKey: '◆', ability: passive } })

    const text = wrapper.text()
    expect(text).toContain('Always On')
    // no mana span and no cooldown span when both are zero
    expect(text).not.toContain('mp ')
    expect(text).not.toContain('cd ')
    // no effect chips when effects is empty
    expect(text).not.toContain('dmg')
  })

  it('shows the cooldown (not "no mp") when both on cooldown and unaffordable', () => {
    const wrapper = mountSlot({ interactive: true, manaAvailable: 0, cooldownRemaining: 3 })
    expect(wrapper.text()).toContain('CD 3t')
    expect(wrapper.text()).not.toContain('no mp')
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })

  it('applies cooldown dimming even on a non-interactive slot', () => {
    const wrapper = mountSlot({ cooldownRemaining: 2 })
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.text()).toContain('CD 2t')
    expect(wrapper.classes()).toContain('opacity-50')
  })
})
