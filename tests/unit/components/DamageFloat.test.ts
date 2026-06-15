import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DamageFloat from '../../../app/components/game/DamageFloat.vue'

describe('DamageFloat', () => {
  it('renders taken damage as a negative dire-red number', () => {
    const w = mount(DamageFloat, { props: { floats: [{ id: 1, amount: 120, kind: 'taken' }] } })
    const el = w.find('[data-testid="damage-float-taken"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toBe('-120')
    expect(el.classes()).toContain('text-dire')
  })

  it('renders dealt damage as a positive radiant number', () => {
    const w = mount(DamageFloat, { props: { floats: [{ id: 2, amount: 80, kind: 'dealt' }] } })
    const el = w.find('[data-testid="damage-float-dealt"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toBe('80')
    expect(el.classes()).toContain('text-radiant')
  })

  it('renders one node per float and nothing when empty', () => {
    const many = mount(DamageFloat, {
      props: {
        floats: [
          { id: 1, amount: 10, kind: 'taken' },
          { id: 2, amount: 20, kind: 'dealt' },
        ],
      },
    })
    expect(many.findAll('[data-testid^="damage-float-"]').length).toBe(2)

    const empty = mount(DamageFloat, { props: { floats: [] } })
    expect(empty.findAll('[data-testid^="damage-float-"]').length).toBe(0)
  })
})
