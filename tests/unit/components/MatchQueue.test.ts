import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MatchQueue from '../../../app/components/lobby/MatchQueue.vue'

// MatchQueue auto-imports TerminalPanel + AsciiButton in the live app. The
// components vitest project has no Nuxt auto-import, so we stub them. AsciiButton
// is a real <button> mirroring its label/@click contract for emit assertions.
const AsciiButtonStub = {
  name: 'AsciiButton',
  props: ['label', 'variant', 'disabled'],
  emits: ['click'],
  template: `<button :data-variant="variant" @click="$emit('click', $event)">{{ label }}</button>`,
}

const TerminalPanelStub = {
  name: 'TerminalPanel',
  props: ['title', 'variant'],
  template: `<section><h3 v-if="title">{{ title }}</h3><slot /></section>`,
}

function mountQueue(props: Record<string, unknown> = {}) {
  return mount(MatchQueue, {
    props,
    global: { stubs: { AsciiButton: AsciiButtonStub, TerminalPanel: TerminalPanelStub } },
  })
}

const roster3 = [
  { username: 'alice', mmrBracket: 'Gold' },
  { username: 'bob', mmrBracket: 'Plat' },
  { username: 'carol', mmrBracket: 'Silver' },
]

// The component animates each roster slot "typing in" via a setTimeout (400-600ms)
// per slot, and runs setInterval timers for the elapsed clock + cursor. We drive
// all of these with fake timers so the rendered output is deterministic.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Flush the per-slot typing setTimeout(s) and the bot-fill interval. */
async function settleAnimations() {
  vi.advanceTimersByTime(2000)
  await nextTick()
}

describe('MatchQueue', () => {
  it('renders the matchmaking panel with a CANCEL button', () => {
    const wrapper = mountQueue()
    expect(wrapper.find('[data-testid="match-queue"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('CANCEL')
  })

  describe('progress header', () => {
    it('defaults to 0/10 players found with no roster', () => {
      const wrapper = mountQueue()
      expect(wrapper.text()).toContain('0/10 Players Found')
    })

    it('reflects roster size and a custom matchSize', async () => {
      const wrapper = mountQueue({ roster: roster3, matchSize: 6 })
      await settleAnimations()
      expect(wrapper.text()).toContain('3/6 Players Found')
    })

    it('sets the progress bar width proportional to filled slots', async () => {
      const wrapper = mountQueue({ roster: roster3, matchSize: 6 })
      await settleAnimations()
      const bar = wrapper.find('.bg-ability.transition-all')
      // 3 of 6 → 50%
      expect(bar.attributes('style')).toContain('width: 50%')
    })
  })

  describe('elapsed clock', () => {
    it('starts at 0:00 and ticks up once per second', async () => {
      const wrapper = mountQueue()
      expect(wrapper.text()).toContain('0:00')

      vi.advanceTimersByTime(65_000)
      await nextTick()
      // 65s → 1:05
      expect(wrapper.text()).toContain('1:05')
    })
  })

  describe('roster slots', () => {
    it('renders each real player with username and mmr bracket once typed in', async () => {
      const wrapper = mountQueue({ roster: roster3 })
      await settleAnimations()

      const text = wrapper.text()
      expect(text).toContain('alice')
      expect(text).toContain('[Gold]')
      expect(text).toContain('carol')
      expect(text).toContain('[Silver]')
    })

    it('pads the remaining slots out to matchSize as empty slots', async () => {
      const wrapper = mountQueue({ roster: roster3, matchSize: 10 })
      await settleAnimations()
      // 10 total slot rows regardless of how many are filled
      const rows = wrapper.findAll('.border-l-2')
      expect(rows).toHaveLength(10)
    })

    it('numbers slots with a zero-padded index', async () => {
      const wrapper = mountQueue({ roster: roster3, matchSize: 10 })
      await settleAnimations()
      const text = wrapper.text()
      expect(text).toContain('01')
      expect(text).toContain('10')
    })
  })

  describe('bot filling', () => {
    it('shows the AI-filling banner with the bot count', async () => {
      const wrapper = mountQueue({ roster: roster3, botsFilling: true, botsCount: 4 })
      await settleAnimations()
      const text = wrapper.text()
      expect(text).toContain('Filling with AI opponents')
      expect(text).toContain('(4 bots)')
    })

    it('types bot names in over time and tags them [AI]', async () => {
      // The bot-fill watcher fires on the false→true transition (no immediate),
      // mirroring how the lobby flips `botsFilling` on once matchmaking gives up
      // on humans. Mount idle, then flip it on.
      const wrapper = mountQueue({ roster: roster3, botsFilling: false, botsCount: 3 })
      await wrapper.setProps({ botsFilling: true })

      // bot fill interval is 350ms per bot
      vi.advanceTimersByTime(2000)
      await nextTick()

      const text = wrapper.text()
      expect(text).toContain('Bot Alpha')
      expect(text).toContain('[AI]')
    })

    it('does not show the banner when not filling with bots', () => {
      const wrapper = mountQueue({ roster: roster3 })
      expect(wrapper.text()).not.toContain('Filling with AI opponents')
    })
  })

  describe('footer', () => {
    it('shows an estimated wait when provided', () => {
      const wrapper = mountQueue({ estimatedWaitSeconds: 95 })
      // 95s → 1:35
      expect(wrapper.text()).toContain('Est. wait: ~1:35')
    })

    it('omits the estimated wait when not provided', () => {
      const wrapper = mountQueue()
      expect(wrapper.text()).not.toContain('Est. wait')
    })

    it('emits cancel when the CANCEL button is clicked', async () => {
      const wrapper = mountQueue()
      await wrapper.get('[data-variant="danger"]').trigger('click')
      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })
  })
})
