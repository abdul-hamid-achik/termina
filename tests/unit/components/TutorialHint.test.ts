import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TutorialHint from '~~/app/components/game/TutorialHint.vue'
import { ICE_DRILL_ZONE, TUTORIAL_FLOW, TUTORIAL_STEP_COUNT } from '~~/shared/constants/tutorial'
import { initializeIce } from '~~/server/game/map/zones'

describe('TutorialHint', () => {
  // Assert against the shared flow rather than literal copy: the hints ARE the
  // teaching, so they get reworded, and a banner that renders whatever the flow
  // says is the actual contract. Hint wording itself is covered in
  // tests/unit/engine/tutorial.test.ts, where it is checked for truthfulness.
  it('shows progress, the current hint, and a try chip at step 0', () => {
    const wrapper = mount(TutorialHint, { props: { step: 0 } })
    expect(wrapper.get('[data-testid="tutorial-progress"]').text()).toBe(`0/${TUTORIAL_STEP_COUNT}`)
    expect(wrapper.get('[data-testid="tutorial-hint-text"]').text()).toContain(
      'move coldstore-t2-chaff',
    )
    expect(wrapper.get('[data-testid="tutorial-try"]').text()).toContain('move coldstore-t2-chaff')
  })

  it('emits the try command so the feed bar can submit it', async () => {
    const wrapper = mount(TutorialHint, { props: { step: 0 } })
    await wrapper.get('[data-testid="tutorial-try"]').trigger('click')
    expect(wrapper.emitted('command')).toEqual([['move coldstore-t2-chaff']])
  })

  it('advances the progress as the step climbs', () => {
    const wrapper = mount(TutorialHint, { props: { step: 1 } })
    expect(wrapper.get('[data-testid="tutorial-progress"]').text()).toBe(`1/${TUTORIAL_STEP_COUNT}`)
  })

  it('marks past drills done, the current drill active, and later drills upcoming', () => {
    const wrapper = mount(TutorialHint, { props: { step: 2 } })
    // move + attack are behind us; strip is current; burn onward is upcoming.
    expect(wrapper.get('[data-testid="tutorial-step-move"]').classes()).toContain('text-chaff')
    expect(wrapper.get('[data-testid="tutorial-step-attack"]').classes()).toContain('text-chaff')
    expect(wrapper.get('[data-testid="tutorial-step-strip"]').classes()).toContain('text-ability')
    expect(wrapper.get('[data-testid="tutorial-step-burn"]').classes()).toContain('text-text-dim')
    expect(wrapper.get('[data-testid="tutorial-step-ice"]').classes()).toContain('text-text-dim')
  })

  it('switches to the completion message once past the last step', () => {
    const wrapper = mount(TutorialHint, { props: { step: TUTORIAL_STEP_COUNT } })
    expect(wrapper.find('[data-testid="tutorial-hint-text"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="tutorial-complete"]').text()).toContain('complete')
    // Progress clamps at the total rather than overflowing.
    expect(wrapper.get('[data-testid="tutorial-progress"]').text()).toBe(
      `${TUTORIAL_STEP_COUNT}/${TUTORIAL_STEP_COUNT}`,
    )
  })

  it('the ICE drill names an ICE still standing when waves razed the drill T1', () => {
    const step = TUTORIAL_FLOW.findIndex((s) => s.id === 'ice')
    const ice = initializeIce().map((t) =>
      t.zone === ICE_DRILL_ZONE ? { ...t, alive: false, integ: 0 } : t,
    )
    const wrapper = mount(TutorialHint, {
      props: { step, zone: 'rookery-anchor', inventory: [], ice, team: 'chaff' as const },
    })
    expect(wrapper.get('[data-testid="tutorial-try"]').text()).toContain(
      'attack ice:coldstore-t2-audit',
    )
    expect(wrapper.get('[data-testid="tutorial-hint-text"]').text()).toContain(
      'attack ice:coldstore-t2-audit',
    )
    expect(wrapper.text()).not.toContain(ICE_DRILL_ZONE)
  })

  it('offers the next unsatisfied command, not a stale one (playtest2 #4)', async () => {
    // Step 6 (tap) with a camtap already held: "try: buy camtap" stayed up.
    const wrapper = mount(TutorialHint, {
      props: {
        step: 6,
        zone: 'rookery-terminal',
        inventory: ['camtap', null, null, null, null, null],
      },
    })
    expect(wrapper.get('[data-testid="tutorial-try"]').text()).toContain('tap rookery-terminal')
    await wrapper.get('[data-testid="tutorial-try"]').trigger('click')
    expect(wrapper.emitted('command')).toEqual([['tap rookery-terminal']])
  })

  // Playtest 3: no wave in the zone, the chip still said `attack wave:0` and the
  // server rejected it. GameScreen passes the visible waves; the chip is live.
  it('never offers a wave:N chip with no wave in the zone', () => {
    const strip = TUTORIAL_FLOW.findIndex((s) => s.id === 'strip')
    const wrapper = mount(TutorialHint, {
      props: {
        step: strip,
        zone: 'coldstore-t2-chaff',
        team: 'chaff',
        waves: [
          {
            id: 'w1',
            team: 'audit',
            zone: 'coldstore-t1-chaff',
            integ: 80,
            maxInteg: 400,
            type: 'line',
          },
        ],
      },
    })
    expect(wrapper.get('[data-testid="tutorial-try"]').text()).toBe('try: move coldstore-t1-chaff')
  })

  it('judges the walk chip against the LIVE ICE it is handed (round-4 review)', () => {
    const strip = TUTORIAL_FLOW.findIndex((s) => s.id === 'strip')
    const unitAt = (zone: string) => [
      { id: 'w1', team: 'audit' as const, zone, integ: 80, maxInteg: 400, type: 'line' as const },
    ]
    const ice = initializeIce()
    const mountAt = (iceState: typeof ice) =>
      mount(TutorialHint, {
        props: {
          step: strip,
          zone: 'coldstore-t2-chaff',
          team: 'chaff',
          waves: unitAt('coldstore-t1-audit'),
          ice: iceState,
        },
      })
    // Under a live enemy ICE: no walk offered.
    expect(mountAt(ice).find('[data-testid="tutorial-try"]').exists()).toBe(false)
    // That ICE razed: fair ground.
    const razed = ice.map((t) =>
      t.zone === 'coldstore-t1-audit' ? { ...t, alive: false, integ: 0 } : t,
    )
    expect(mountAt(razed).get('[data-testid="tutorial-try"]').text()).toBe(
      'try: move coldstore-t1-audit',
    )
  })
})
