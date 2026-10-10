import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandInput from '~~/app/components/game/CommandInput.vue'
import type { PlayerState } from '~~/shared/types/game'
import { initializeIce } from '~~/server/game/map/zones'
import { initializeTerminals } from '~~/server/game/engine/TerminalSystem'
import { pathDistance } from '~~/shared/pathfinding'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { approachStructure } from '~~/server/game/engine/ActionResolver'

function makePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'me',
    name: 'Me',
    team: 'chaff',
    heroId: 'echo',
    zone: 'rookery-anchor',
    integ: 500,
    maxInteg: 500,
    bw: 300,
    maxBw: 300,
    level: 7,
    xp: 0,
    scrip: 1000,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
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
      await input.setValue('move coldstore')

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
      await input.setValue('move coldstore')
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('submit')).toBeTruthy()
      expect(wrapper.emitted('submit')![0]).toEqual(['move coldstore'])
    })

    it('shows the buffered command notice', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false, bufferedCommand: 'cast q' },
      })

      const notice = wrapper.find('[data-testid="buffered-command"]')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain('cast q')
      expect(notice.text()).toContain('next cycle')
    })

    it('shows the pending command in the placeholder while waiting', () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: false, pendingCommand: 'move coldstore-cross' },
      })

      const input = wrapper.find('input')
      expect(input.attributes('placeholder')).toContain('move coldstore-cross')
    })

    it('should emit submit on Enter', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true },
      })

      const input = wrapper.find('input')

      await input.setValue('move coldstore')
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('submit')).toBeTruthy()
      expect(wrapper.emitted('submit')![0]).toEqual(['move coldstore'])
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
      ['tap', 'specify a zone'],
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
      // Caster in the fountain — adjacent only to rookery-terminal, the one legal move.
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await wrapper.find('input').setValue('move rookery-terminal')
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
   * itself a suggestion it accepted a longer neighbour instead (`w` → `tap`,
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

    it('submits `w` as the W shortcut, not the `tap` suggestion above it', async () => {
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

    it('previews `w` as the cast it performs, not as a half-typed `tap`', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      await wrapper.find('input').setValue('w')
      expect(wrapper.get('[data-testid="command-preview"]').text()).toContain('Cast W')
    })

    it('submits `move coldstore` instead of completing it to the tier-3 ice', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      const input = await typeAndEnter(wrapper, 'move coldstore')
      expect(wrapper.emitted('submit')?.[0]).toEqual(['move coldstore'])
      expect((input.element as HTMLInputElement).value).not.toContain('coldstore-t3-chaff')
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
      await input.setValue('move coldstore')
      await input.trigger('keydown', { key: 'ArrowDown' })
      await input.trigger('keydown', { key: 'Enter' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('submit')).toBeUndefined()
      expect((input.element as HTMLInputElement).value.trim()).not.toBe('move coldstore')
      expect((input.element as HTMLInputElement).value).toContain('move coldstore-')
    })

    // Playtest 26.png: Enter on `cast q socket` rewrote the line to
    // `cast q hero:socket` instead of firing the cast.
    describe('a finished order is sent, a half-typed one completed', () => {
      const socket = {
        ...makePlayer({ id: 'bot_s', name: 'bot_s', heroId: 'socket', team: 'audit' }),
        zone: 'coldstore-cross',
      }
      const me = makePlayer({ zone: 'coldstore-cross' })
      const withEnemy = { canAct: true, player: me, allPlayers: { me, bot_s: socket } }

      it('submits `cast q socket` as typed', async () => {
        const wrapper = mount(CommandInput, { props: withEnemy })
        const input = await typeAndEnter(wrapper, 'cast q socket')
        expect(wrapper.emitted('submit')?.[0]).toEqual(['cast q socket'])
        expect((input.element as HTMLInputElement).value).toBe('')
      })

      it('completes `cast q soc` instead of firing an untargeted Q', async () => {
        const wrapper = mount(CommandInput, { props: withEnemy })
        const input = await typeAndEnter(wrapper, 'cast q soc')
        expect(wrapper.emitted('submit')).toBeUndefined()
        expect((input.element as HTMLInputElement).value).toContain('hero:socket')
      })

      it('completes `buy edge` to a real item rather than sending an unknown one', async () => {
        const items = { edge_kit: { id: 'edge_kit', name: 'Edge Kit', cost: 100 } } as never
        const wrapper = mount(CommandInput, {
          props: { canAct: true, player: makePlayer({ zone: 'rookery-anchor' }), items },
        })
        const input = await typeAndEnter(wrapper, 'buy edge')
        expect(wrapper.emitted('submit')).toBeUndefined()
        expect((input.element as HTMLInputElement).value).toContain('edge_kit')
      })

      it('completes `move cold` (ambiguous) instead of sending it', async () => {
        const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
        await typeAndEnter(wrapper, 'move cold')
        expect(wrapper.emitted('submit')).toBeUndefined()
      })
    })

    it('reads `move crossing` as the crossing of the route the player stands on', async () => {
      const wrapper = mount(CommandInput, {
        props: { canAct: true, player: makePlayer({ zone: 'coldstore-t1-chaff' }) },
      })
      await wrapper.find('input').setValue('move crossing')
      expect(wrapper.get('[data-testid="command-preview"]').text()).toContain('Coldstore Crossing')
    })

    // Playtest 24.png: a refused command only showed as the faint `!!` line
    // under the prompt. Enter now hands the reason up for the STREAM.
    it('hands a refused command’s reason to the parent on Enter', async () => {
      const wrapper = mount(CommandInput, { props: { canAct: true, player: makePlayer() } })
      const input = await typeAndEnter(wrapper, 'move banana')
      expect(wrapper.emitted('submit')).toBeUndefined()
      expect(wrapper.emitted('reject')?.[0]?.[0]).toContain('No zone called "banana"')
      expect((input.element as HTMLInputElement).value).toBe('move banana')
    })

    // playtest2 30.png: a refused `attack ice:…` kept its `!!` reason under the
    // prompt through a death and a respawn — about a situation long over.
    it('drops a refused command it kept once the situation changes (respawn, step)', async () => {
      const wrapper = mount(CommandInput, {
        props: {
          canAct: true,
          player: makePlayer(),
          situationKey: 'up:7',
          // A protected T2 — still refused (an out-of-zone T1 is a walk now).
          ice: initializeIce(),
          terminals: initializeTerminals(),
        },
      })
      const input = await typeAndEnter(wrapper, 'attack ice:coldstore-t2-audit')
      expect(wrapper.emitted('reject')?.[0]?.[0]).toContain('ice')
      expect((input.element as HTMLInputElement).value).toBe('attack ice:coldstore-t2-audit')

      await wrapper.setProps({ situationKey: 'down:7' })
      expect((input.element as HTMLInputElement).value).toBe('')
      expect(wrapper.find('[data-testid="command-preview"]').exists()).toBe(false)
    })

    it('keeps what the player typed AFTER a refusal when the situation changes', async () => {
      const wrapper = mount(CommandInput, {
        props: {
          canAct: true,
          player: makePlayer(),
          situationKey: 'up:7',
          // A protected T2 — still refused (an out-of-zone T1 is a walk now).
          ice: initializeIce(),
          terminals: initializeTerminals(),
        },
      })
      const input = await typeAndEnter(wrapper, 'attack ice:coldstore-t2-audit')
      await input.setValue('move rookery-terminal')
      await wrapper.setProps({ situationKey: 'down:7' })
      expect((input.element as HTMLInputElement).value).toBe('move rookery-terminal')
    })

    it('a later, freshly typed copy of a once-refused command survives a situation change', async () => {
      // The refusal is handled (fixed and submitted); later the same text is
      // typed again from scratch — it is the player's, not the old refusal.
      const ice = initializeIce()
      const wrapper = mount(CommandInput, {
        props: {
          canAct: true,
          player: makePlayer(),
          situationKey: 'up:7',
          ice,
          terminals: initializeTerminals(),
        },
      })
      const input = await typeAndEnter(wrapper, 'attack ice:coldstore-t2-audit')
      expect(wrapper.emitted('reject')).toHaveLength(1)
      // T1 falls: the same order is now legal and goes through.
      const t1Down = ice.map((t) =>
        t.zone === 'coldstore-t1-audit' ? { ...t, alive: false, integ: 0 } : t,
      )
      await wrapper.setProps({ ice: t1Down })
      await input.trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('submit')?.[0]?.[0]).toBe('attack ice:coldstore-t2-audit')
      // Typed again, fresh, then the situation changes before Enter.
      await input.setValue('attack ice:coldstore-t2-audit')
      await wrapper.setProps({ situationKey: 'down:7' })
      expect((input.element as HTMLInputElement).value).toBe('attack ice:coldstore-t2-audit')
    })

    it('a refusal edited away and retyped identically is the player’s again', async () => {
      const wrapper = mount(CommandInput, {
        props: {
          canAct: true,
          player: makePlayer(),
          situationKey: 'up:7',
          ice: initializeIce(),
          terminals: initializeTerminals(),
        },
      })
      const input = await typeAndEnter(wrapper, 'attack ice:coldstore-t2-audit')
      await input.setValue('')
      await input.setValue('attack ice:coldstore-t2-audit')
      await wrapper.setProps({ situationKey: 'down:7' })
      expect((input.element as HTMLInputElement).value).toBe('attack ice:coldstore-t2-audit')
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
    // would make `sell`, `tap`, `scan` and `surrender` untypable.
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
      // `sell`, `tap`, `cache` and `1` as an argument all start with them.
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

// `attack ice:<zone>` from range is a walk + held attack on the server
// (ActionResolver.approachStructure). The preview says so, with the ETA.
describe('CommandInput structure-approach preview', () => {
  it('previews the walk and the held ICE attack with the path length', async () => {
    const player = makePlayer({ zone: 'rookery-anchor' })
    const wrapper = mount(CommandInput, {
      props: { canAct: true, player, ice: initializeIce(), terminals: initializeTerminals() },
    })
    await wrapper.find('input').setValue('attack ice:coldstore-t1-audit')
    const n = pathDistance('rookery-anchor', 'coldstore-t1-audit')
    expect(n).toBeGreaterThan(1)
    expect(wrapper.get('[data-testid="command-preview"]').text()).toBe(
      `>> Walk to ${ZONE_MAP['coldstore-t1-audit']!.name} (${n} cycles), then attack ICE`,
    )
  })

  it('says "1 cycle" for an adjacent ICE', async () => {
    const player = makePlayer({ zone: 'coldstore-cross' })
    const wrapper = mount(CommandInput, { props: { canAct: true, player } })
    await wrapper.find('input').setValue('attack ice:coldstore-t1-audit')
    expect(wrapper.get('[data-testid="command-preview"]').text()).toBe(
      `>> Walk to ${ZONE_MAP['coldstore-t1-audit']!.name} (1 cycle), then attack ICE`,
    )
  })

  it('keeps the plain attack line in the ICE’s own zone', async () => {
    const player = makePlayer({ zone: 'coldstore-t1-audit' })
    const wrapper = mount(CommandInput, { props: { canAct: true, player } })
    await wrapper.find('input').setValue('attack ice:coldstore-t1-audit')
    expect(wrapper.get('[data-testid="command-preview"]').text()).toBe(
      '>> Attack ice in coldstore-t1-audit',
    )
  })

  it('shows the server’s refusal for a protected ICE instead of a walk', async () => {
    const player = makePlayer({ zone: 'rookery-anchor' })
    const wrapper = mount(CommandInput, {
      props: { canAct: true, player, ice: initializeIce(), terminals: initializeTerminals() },
    })
    await wrapper.find('input').setValue('attack ice:coldstore-t2-audit')
    expect(wrapper.get('[data-testid="command-preview"]').text()).toBe(
      '!! That ice is protected — destroy the one in front of it first',
    )
  })

  it('a Hardened ICE previews the walk with the SAME note the server replies with', async () => {
    const player = makePlayer({ zone: 'coldstore-cross' })
    const ice = initializeIce().map((t) => (t.team === 'audit' ? { ...t, invulnerable: true } : t))
    const teams = {
      chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: 40 },
    } as const
    // On screen: cycle 42 committed. The order resolves in cycle 43 — the
    // cycle the server's approachStructure judges it in.
    const server = approachStructure(
      { cycle: 43, ice, teams, terminals: initializeTerminals(), players: { p1: player } } as never,
      {
        playerId: 'p1',
        command: { type: 'attack', target: { kind: 'ice', zone: 'coldstore-t1-audit' } },
      },
    )
    const note = server && 'walk' in server ? server.note : undefined
    expect(note).toBe(
      'That ice is Hardened for 3 more cycles — walking there anyway; the attack lands once it expires',
    )
    const wrapper = mount(CommandInput, {
      props: { canAct: true, player, ice, teams, cycle: 42, terminals: initializeTerminals() },
    })
    await wrapper.find('input').setValue('attack ice:coldstore-t1-audit')
    expect(wrapper.get('[data-testid="command-preview"]').text()).toBe(
      `>> Walk to ${ZONE_MAP['coldstore-t1-audit']!.name} (1 cycle), then attack ICE — ${note}`,
    )
  })

  it('previews the walk to an exposed enemy Terminal', async () => {
    const player = makePlayer({ zone: 'rookery-anchor' })
    const ice = initializeIce().map((t) =>
      t.zone === 'coldstore-t3-audit' ? { ...t, alive: false, integ: 0 } : t,
    )
    const wrapper = mount(CommandInput, {
      props: { canAct: true, player, ice, terminals: initializeTerminals() },
    })
    await wrapper.find('input').setValue('attack terminal')
    const n = pathDistance('rookery-anchor', 'landing-terminal')
    expect(wrapper.get('[data-testid="command-preview"]').text()).toBe(
      `>> Walk to ${ZONE_MAP['landing-terminal']!.name} (${n} cycles), then attack the enemy Terminal`,
    )
  })
})
