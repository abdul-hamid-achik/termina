import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DamageFloat from '~~/app/components/game/DamageFloat.vue'

describe('DamageFloat', () => {
  it('renders taken damage as a negative audit-red number', () => {
    const w = mount(DamageFloat, { props: { floats: [{ id: 1, amount: 120, kind: 'taken' }] } })
    const el = w.find('[data-testid="damage-float-taken"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toBe('-120')
    expect(el.classes()).toContain('text-audit')
  })

  it('renders dealt damage as a positive chaff number', () => {
    const w = mount(DamageFloat, { props: { floats: [{ id: 2, amount: 80, kind: 'dealt' }] } })
    const el = w.find('[data-testid="damage-float-dealt"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toBe('80')
    expect(el.classes()).toContain('text-chaff')
  })

  it('renders a heal as a positive teal number with a + prefix', () => {
    const w = mount(DamageFloat, { props: { floats: [{ id: 3, amount: 50, kind: 'heal' }] } })
    const el = w.find('[data-testid="damage-float-heal"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toBe('+50')
    expect(el.classes()).toContain('text-healing')
    // distinct from the chaff green used for dealt damage
    expect(el.classes()).not.toContain('text-chaff')
  })

  it('renders gold income as an amber +Ng, never mistakable for damage', () => {
    const w = mount(DamageFloat, { props: { floats: [{ id: 4, amount: 41, kind: 'gold' }] } })
    const el = w.find('[data-testid="damage-float-gold"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toBe('+41g')
    expect(el.classes()).toContain('text-gold')
    expect(el.classes()).not.toContain('text-chaff')
  })

  it('only the gold float carries the currency suffix', () => {
    const w = mount(DamageFloat, {
      props: {
        floats: [
          { id: 1, amount: 10, kind: 'taken' },
          { id: 2, amount: 20, kind: 'dealt' },
          { id: 3, amount: 30, kind: 'heal' },
        ],
      },
    })
    expect(w.text()).not.toContain('g')
  })

  it('places each float absolutely at an offset derived from its id', () => {
    // REGRESSION: floats were flex-column siblings, so pruning the oldest one
    // yanked every survivor upward mid-animation and a number's position meant
    // nothing. The offset must depend on the entry alone.
    const withNeighbours = mount(DamageFloat, {
      props: {
        floats: [
          { id: 1, amount: 10, kind: 'taken' },
          { id: 2, amount: 20, kind: 'taken' },
          { id: 3, amount: 30, kind: 'taken' },
        ],
      },
    })
    const third = withNeighbours.findAll('[data-testid="damage-float-taken"]')[2]!
    expect(third.classes()).toContain('absolute')
    const placed = third.attributes('style')

    // Same entry, its neighbours pruned: it must not have moved.
    const alone = mount(DamageFloat, { props: { floats: [{ id: 3, amount: 30, kind: 'taken' }] } })
    expect(alone.find('[data-testid="damage-float-taken"]').attributes('style')).toBe(placed)
  })

  it('separates the two lanes so taken and dealt numbers do not stack', () => {
    const self = mount(DamageFloat, {
      props: { anchor: 'self', floats: [{ id: 1, amount: 10, kind: 'taken', anchor: 'self' }] },
    })
    const target = mount(DamageFloat, {
      props: { anchor: 'target', floats: [{ id: 2, amount: 20, kind: 'dealt', anchor: 'target' }] },
    })

    const selfRoot = self.find('[data-testid="damage-floats"]')
    const targetRoot = target.find('[data-testid="damage-floats"]')
    expect(selfRoot.attributes('data-anchor')).toBe('self')
    expect(targetRoot.attributes('data-anchor')).toBe('target')
    expect(selfRoot.classes()).not.toEqual(targetRoot.classes())
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
