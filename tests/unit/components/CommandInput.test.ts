import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandInput from '~~/app/components/game/CommandInput.vue'
import type { PlayerState } from '~~/shared/types/game'

function makePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'me',
    name: 'Me',
    team: 'chaff',
    heroId: 'echo',
    zone: 'chaff-fountain',
    integ: 500,
    maxInteg: 500,
    bw: 300,
    maxBw: 300,
    level: 7,
    xp: 0,
    gold: 1000,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    plate: 5,
    ice: 5,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
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

      const input = wrapper.find('input')
      await input.setValue('move mid')
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

      const input = wrapper.find('input')

      await input.setValue('move mid')
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
      ['burn', 'lowest-INTEG allied wave'],
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
      expect(preview.classes()).toContain('text-chaff') // valid (not an error/dim hint)
    })

    it('shows a valid MOVE preview to an adjacent zone, resolving its name', async () => {
      // Caster in the fountain — adjacent only to chaff-base, the one legal move.
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await wrapper.find('input').setValue('move chaff-base')
      const preview = wrapper.get('[data-testid="command-preview"]')
      expect(preview.text()).toContain('Move to')
      expect(preview.classes()).toContain('text-chaff')
    })
  })

  describe('keyboard navigation', () => {
    it('ArrowDown moves the highlighted suggestion', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true } })
      const input = wrapper.find('input')
      await input.setValue('m') // several suggestions: move / map / missing
      await wrapper.vm.$nextTick()

      const before = wrapper.find('.cmd-selected').text()
      await input.trigger('keydown', { key: 'ArrowDown' })
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.cmd-selected').text()).not.toBe(before)
    })

    it('Tab accepts the highlighted suggestion into the input', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true } })
      const input = wrapper.find('input')
      await input.setValue('mov')
      await input.trigger('keydown', { key: 'Tab' })
      await wrapper.vm.$nextTick()
      expect((input.element as HTMLInputElement).value).toContain('move')
    })

    it('Escape closes the dropdown first, then clears the input', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true } })
      const input = wrapper.find('input')
      await input.setValue('move')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.cmd-selected').exists()).toBe(true) // dropdown open

      await input.trigger('keydown', { key: 'Escape' }) // close dropdown
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.cmd-selected').exists()).toBe(false)

      await input.trigger('keydown', { key: 'Escape' }) // now clear the text
      await wrapper.vm.$nextTick()
      expect((input.element as HTMLInputElement).value).toBe('')
    })

    it('Enter accepts a single matching suggestion instead of submitting', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true } })
      const input = wrapper.find('input')
      await input.setValue('mov') // single suggestion 'move', input not yet equal
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()
      expect((input.element as HTMLInputElement).value).toContain('move')
      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('ArrowUp recalls the previous command from history when the dropdown is closed', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true } })
      const input = wrapper.find('input')
      // Submit a command to populate history, then clear + close the dropdown.
      await input.setValue('status')
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('submit')).toBeTruthy()

      await input.trigger('keydown', { key: 'ArrowUp' })
      await wrapper.vm.$nextTick()
      expect((input.element as HTMLInputElement).value).toBe('status')
    })
  })

  /**
   * REGRESSION: the Enter path used to re-fill the input with a completion that
   * was byte-identical to what was already typed, so `cast q` — the tutorial's
   * literal instruction — could never be submitted; and when the typed text was
   * itself a suggestion it accepted a longer neighbour instead (`w` → `ward`,
   * `r` → `cache`), hijacking two ability shortcuts including the ultimate.
   *
   * These drive the component the way a player does — `input.setValue()` and a
   * real keydown, never `vm.open` — because hand-closing the dropdown first is
   * exactly what hid all three bugs.
   */
  describe('Enter submits what the player typed', () => {
    async function typeAndEnter(wrapper: ReturnType<typeof mount>, value: string) {
      const input = wrapper.find('input')
      await input.setValue(value)
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()
      return input
    }

    it('submits `cast q` — the tutorial instructs this verbatim', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await typeAndEnter(wrapper, 'cast q')
      expect(wrapper.emitted('submit')?.[0]).toEqual(['cast q'])
    })

    it('submits `talent 10 left`', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true, player: makePlayer({ level: 10 }) },
      })
      await typeAndEnter(wrapper, 'talent 10 left')
      expect(wrapper.emitted('submit')?.[0]).toEqual(['talent 10 left'])
    })

    it('submits `surrender confirm`', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await typeAndEnter(wrapper, 'surrender confirm')
      expect(wrapper.emitted('submit')?.[0]).toEqual(['surrender confirm'])
    })

    it('submits `w` as the W shortcut, not the `ward` suggestion above it', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      const input = await typeAndEnter(wrapper, 'w')
      expect(wrapper.emitted('submit')?.[0]).toEqual(['w'])
      expect((input.element as HTMLInputElement).value).toBe('')
    })

    it('submits `r` as the ultimate shortcut, not the `cache` suggestion above it', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await typeAndEnter(wrapper, 'r')
      expect(wrapper.emitted('submit')?.[0]).toEqual(['r'])
    })

    it('previews `w` as the cast it performs, not as a half-typed `ward`', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await wrapper.find('input').setValue('w')
      expect(wrapper.get('[data-testid="command-preview"]').text()).toContain('Cast W')
    })

    it('submits `move mid` instead of completing it to the tier-3 ice', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      const input = await typeAndEnter(wrapper, 'move mid')
      expect(wrapper.emitted('submit')?.[0]).toEqual(['move mid'])
      expect((input.element as HTMLInputElement).value).not.toContain('mid-t3-chaff')
    })

    it('still completes a genuine prefix rather than submitting it', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true } })
      const input = await typeAndEnter(wrapper, 'mov')
      expect(wrapper.emitted('submit')).toBeUndefined()
      expect((input.element as HTMLInputElement).value).toBe('move ')
    })

    it('takes an explicitly highlighted suggestion over the typed text', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      const input = wrapper.find('input')
      await input.setValue('move mid')
      await input.trigger('keydown', { key: 'ArrowDown' })
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('submit')).toBeUndefined()
      expect((input.element as HTMLInputElement).value.trim()).not.toBe('move mid')
      expect((input.element as HTMLInputElement).value).toContain('move mid-')
    })

    it('does not submit `chat team` — its "needs a message" error still gates it', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await typeAndEnter(wrapper, 'chat team')
      expect(wrapper.emitted('submit')).toBeUndefined()
      expect(wrapper.get('[data-testid="command-preview"]').text()).toContain('chat <team|all>')
    })
  })

  /**
   * REGRESSION: the prompt auto-focuses and every in-game hotkey is suppressed
   * while it has focus, so the whole advertised keyboard layer (S, Q/W/E/R, 1-6,
   * arrows) was unreachable — pressing S typed an `s`. Escape is the release
   * valve, and the harden is how the player can tell which mode they are in.
   */
  describe('keyboard mode', () => {
    function mountFocused() {
      const wrapper = mount(CommandInput, { props: { canAct: true }, attachTo: document.body })
      const input = wrapper.find('input')
      ;(input.element as HTMLInputElement).focus()
      return { wrapper, input }
    }

    it('releases focus on Escape once there is nothing left to clear', async () => {
      const { wrapper, input } = mountFocused()
      expect(document.activeElement).toBe(input.element)

      await input.setValue('move')
      await input.trigger('keydown', { key: 'Escape' }) // closes the dropdown
      expect(document.activeElement).toBe(input.element)
      await input.trigger('keydown', { key: 'Escape' }) // clears the text
      expect((input.element as HTMLInputElement).value).toBe('')
      expect(document.activeElement).toBe(input.element)

      await input.trigger('keydown', { key: 'Escape' }) // hands over the keyboard
      expect(document.activeElement).not.toBe(input.element)
      wrapper.unmount()
    })

    it('keeps focus while Escape still has text to clear', async () => {
      const { wrapper, input } = mountFocused()
      await input.setValue('zzz') // matches nothing, so the dropdown is closed
      await input.trigger('keydown', { key: 'Escape' })

      expect((input.element as HTMLInputElement).value).toBe('')
      expect(document.activeElement).toBe(input.element)
      wrapper.unmount()
    })

    it('shows >_ while typing and [KEYS] once the keyboard belongs to the game', async () => {
      const { wrapper, input } = mountFocused()
      await wrapper.vm.$nextTick()
      expect(wrapper.get('[data-testid="prompt-harden"]').text()).toBe('>_')

      await input.trigger('keydown', { key: 'Escape' })
      await wrapper.vm.$nextTick()
      expect(wrapper.get('[data-testid="prompt-harden"]').text()).toBe('[KEYS]')

      // And back: clicking the prompt is the documented way to resume typing.
      await wrapper.find('.cmd-input-wrapper').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.get('[data-testid="prompt-harden"]').text()).toBe('>_')
      wrapper.unmount()
    })

    it('hides the blinking caret in keyboard mode — nothing there accepts letters', async () => {
      const { wrapper, input } = mountFocused()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.animate-blink').exists()).toBe(true)

      await input.trigger('keydown', { key: 'Escape' })
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.animate-blink').exists()).toBe(false)
      wrapper.unmount()
    })
  })

  describe('unchanged deliberate behaviour', () => {
    // Both of these are load-bearing, not oversights: the refocus is a
    // pre-typing affordance, and swallowing single letters on an empty prompt
    // would make `sell`, `ward`, `scan` and `surrender` untypable.
    it('refocuses the prompt after a successful send', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true }, attachTo: document.body })
      const input = wrapper.find('input')
      ;(input.element as HTMLInputElement).focus()

      await input.setValue('status')
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('submit')).toBeTruthy()
      expect(document.activeElement).toBe(input.element)
      wrapper.unmount()
    })

    it('lets letters that collide with hotkeys through to the box, even when empty', () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      const input = wrapper.find('input').element

      // `s` (shop), `w`/`r` (abilities) and `1` (item slot) must still type:
      // `sell`, `ward`, `cache` and `1` as an argument all start with them.
      for (const key of ['s', 'w', 'r', '1']) {
        const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
        input.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
      expect(wrapper.emitted('submit')).toBeUndefined()
      wrapper.unmount()
    })

    /**
     * R3-09 — while the prompt owns focus, printable characters are text, not
     * HUD shortcuts. gameKeys already returns `none` when isInputFocused; this
     * asserts the input itself never preventDefaults those keys (so they type).
     */
    it('does not swallow printable characters that double as HUD shortcuts while focused', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true, player: makePlayer() },
        attachTo: document.body,
      })
      const input = wrapper.find('input')
      ;(input.element as HTMLInputElement).focus()

      for (const key of ['s', 'q', 'w', 'e', 'r', '1', 't', 'a']) {
        const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
        input.element.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
      wrapper.unmount()
    })
  })
})
