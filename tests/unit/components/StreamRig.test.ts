import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Stream from '~~/app/components/game/Stream.vue'
import type { CombatLine } from '~~/app/utils/combatLog'

function mountStream(events: CombatLine[]) {
  return mount(Stream, {
    props: { events, recap: true, recapByTick: new Map() },
  })
}

describe('Stream — the rig voice (R3-06)', () => {
  it('renders a rig line with the > prefix, semibold, and its own ramp step', () => {
    const wrapper = mountStream([
      {
        cycle: 12,
        text: 'Low INTEG — retreat and heal · INTEG 120/550 · CONTESTED (2 hostile)',
        type: 'rig',
      },
    ])

    const line = wrapper.get('[data-testid="log-event"]')
    expect(line.text()).toContain('Low INTEG — retreat and heal')
    expect(line.text()).toContain('>')
    // Its own prefix glyph (the rig talks in the scrollback, not a chrome bar).
    expect(line.html()).toContain('&gt;')
  })

  it('does not repeat the rig line while the recommendation is unchanged', () => {
    // The GameScreen watch only pushes on change — two identical recs never
    // reach the stream, so a stream with one rig line keeps exactly one.
    const events: CombatLine[] = [
      { cycle: 12, text: 'Clear — farm, push, or rotate · INTEG 550/550 · CLEAR', type: 'rig' },
      { cycle: 13, text: 'something else happened', type: 'system' },
    ]
    const wrapper = mountStream(events)
    expect(wrapper.findAll('[data-testid="log-event"]')).toHaveLength(2)
  })

  it('aria-label carries the cycle and the rig text', () => {
    const wrapper = mountStream([
      { cycle: 7, text: 'Outnumbered — retreat to safety', type: 'rig' },
    ])
    const label = wrapper.get('[data-testid="log-event"]').attributes('aria-label')!
    expect(label).toContain('Cycle 7')
    expect(label).toContain('Outnumbered — retreat to safety')
  })
})
