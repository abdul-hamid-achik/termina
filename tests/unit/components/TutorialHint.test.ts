import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TutorialHint from '../../../app/components/game/TutorialHint.vue'
import { TUTORIAL_STEP_COUNT } from '../../../shared/constants/tutorial'

describe('TutorialHint', () => {
  it('shows the current step hint and progress at step 0', () => {
    const wrapper = mount(TutorialHint, { props: { step: 0 } })
    expect(wrapper.get('[data-testid="tutorial-progress"]').text()).toBe(`0/${TUTORIAL_STEP_COUNT}`)
    expect(wrapper.get('[data-testid="tutorial-hint-text"]').text()).toContain('Walk down')
  })

  it('advances the hint as the step climbs', () => {
    const wrapper = mount(TutorialHint, { props: { step: 1 } })
    expect(wrapper.get('[data-testid="tutorial-hint-text"]').text()).toContain('Last-hit')
    expect(wrapper.get('[data-testid="tutorial-progress"]').text()).toBe(`1/${TUTORIAL_STEP_COUNT}`)
  })

  it('marks past verbs done, the current verb active, and later verbs upcoming', () => {
    const wrapper = mount(TutorialHint, { props: { step: 2 } })
    // move + attack are behind us; cast is current; buy is upcoming.
    expect(wrapper.get('[data-testid="tutorial-step-move"]').classes()).toContain('text-radiant')
    expect(wrapper.get('[data-testid="tutorial-step-attack"]').classes()).toContain('text-radiant')
    expect(wrapper.get('[data-testid="tutorial-step-cast"]').classes()).toContain('text-ability')
    expect(wrapper.get('[data-testid="tutorial-step-buy"]').classes()).toContain('text-text-dim')
  })

  it('switches to the completion message once past the last step (free play)', () => {
    const wrapper = mount(TutorialHint, { props: { step: TUTORIAL_STEP_COUNT } })
    expect(wrapper.find('[data-testid="tutorial-hint-text"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="tutorial-complete"]').text()).toContain('free play')
    // Progress clamps at the total rather than overflowing.
    expect(wrapper.get('[data-testid="tutorial-progress"]').text()).toBe(
      `${TUTORIAL_STEP_COUNT}/${TUTORIAL_STEP_COUNT}`,
    )
  })
})
