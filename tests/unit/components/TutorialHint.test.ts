import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TutorialHint from '~~/app/components/game/TutorialHint.vue'
import { TUTORIAL_STEP_COUNT } from '~~/shared/constants/tutorial'

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
})
