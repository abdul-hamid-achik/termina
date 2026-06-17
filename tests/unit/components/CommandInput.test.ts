import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandInput from '../../../app/components/game/CommandInput.vue'
import type { PlayerState } from '../../../shared/types/game'

function makePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'me',
    name: 'Me',
    team: 'radiant',
    heroId: 'echo',
    zone: 'radiant-fountain',
    hp: 500,
    maxHp: 500,
    mp: 300,
    maxMp: 300,
    level: 7,
    xp: 0,
    gold: 1000,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 5,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...over,
  } as PlayerState
}

describe('CommandInput', () => {
  describe('accessibility', () => {
    it('should announce validation errors', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
        attachTo: document.body,
      })

      const input = wrapper.find('input')
      await input.setValue('move invalid-zone-xyz')

      const liveRegion = wrapper.find('[aria-live="polite"]')
      expect(liveRegion.exists()).toBe(true)
    })

    it('should have accessible label for input', () => {
      const wrapper = mount(CommandInput)

      const input = wrapper.find('input')
      expect(input.attributes('aria-label')).toBeDefined()
    })

    it('should announce preview changes', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
      })

      const input = wrapper.find('input')
      await input.setValue('move mid')

      const preview = wrapper.find('[data-testid="command-preview"]')
      expect(preview.exists()).toBe(true)
    })
  })

  describe('input behavior', () => {
    it('should show placeholder when empty', () => {
      const wrapper = mount(CommandInput, {
        props: { placeholder: 'Enter command...' },
      })

      const input = wrapper.find('input')
      expect(input.attributes('placeholder')).toBe('Enter command...')
    })

    it('stays editable when canAct is false (pre-typing during the wait)', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false },
      })

      const input = wrapper.find('input')
      expect(input.attributes('disabled')).toBeUndefined()
    })

    it('emits submit while canAct is false so the parent can buffer it', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false },
      })

      const vm = wrapper.vm as { input: string; open: boolean }
      const input = wrapper.find('input')

      vm.input = 'move mid'
      await wrapper.vm.$nextTick()
      vm.open = false
      await wrapper.vm.$nextTick()

      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('submit')).toBeTruthy()
      expect(wrapper.emitted('submit')![0]).toEqual(['move mid'])
    })

    it('shows the buffered command notice', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false, bufferedCommand: 'cast q' },
      })

      const notice = wrapper.find('[data-testid="buffered-command"]')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain('cast q')
      expect(notice.text()).toContain('next tick')
    })

    it('shows the pending command in the placeholder while waiting', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false, pendingCommand: 'move mid-river' },
      })

      const input = wrapper.find('input')
      expect(input.attributes('placeholder')).toContain('move mid-river')
    })

    it('should emit submit on Enter', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
      })

      const vm = wrapper.vm as { input: string; open: boolean }
      const input = wrapper.find('input')

      vm.input = 'move mid'
      await wrapper.vm.$nextTick()

      vm.open = false
      await wrapper.vm.$nextTick()

      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('submit')).toBeTruthy()
      expect(wrapper.emitted('submit')![0]).toEqual(['move mid'])
    })
  })

  describe('autocomplete', () => {
    it('should show suggestions dropdown', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
      })

      const input = wrapper.find('input')
      await input.setValue('mov')
      await input.trigger('focus')

      expect(wrapper.text()).toContain('move')
    })
  })

  describe('command preview hints', () => {
    it('shows a "typing" hint for a partial command name', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true } })
      await wrapper.find('input').setValue('mov')
      const preview = wrapper.get('[data-testid="command-preview"]')
      expect(preview.text()).toContain('typing: mov')
      expect(preview.classes()).toContain('text-text-dim')
    })

    it.each([
      ['move', 'specify a zone'],
      ['attack', 'nearest enemy'],
      ['deny', 'lowest-HP allied creep'],
      ['cast', 'specify ability'],
      ['buy', 'specify an item'],
      ['sell', 'specify an item'],
      ['use', 'active item'],
      ['ward', 'specify a zone'],
      ['chat', 'specify channel'],
      ['ping', 'specify a zone'],
      ['surrender', 'surrender confirm'],
    ])('shows a usage hint for a bare "%s" command', async (cmd, expected) => {
      const wrapper = mount(CommandInput, { props: { canAct: true } })
      await wrapper.find('input').setValue(cmd)
      const preview = wrapper.get('[data-testid="command-preview"]')
      expect(preview.text()).toContain(expected)
      expect(preview.classes()).toContain('text-text-dim')
    })

    it('shows a valid CAST preview for an alive caster with the ability ready', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await wrapper.find('input').setValue('cast q')
      const preview = wrapper.get('[data-testid="command-preview"]')
      expect(preview.text()).toContain('Cast Q')
      expect(preview.classes()).toContain('text-radiant') // valid (not an error/dim hint)
    })

    it('shows a valid MOVE preview to an adjacent zone, resolving its name', async () => {
      // Caster in the fountain — adjacent only to radiant-base, the one legal move.
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await wrapper.find('input').setValue('move radiant-base')
      const preview = wrapper.get('[data-testid="command-preview"]')
      expect(preview.text()).toContain('Move to')
      expect(preview.classes()).toContain('text-radiant')
    })
  })
})
