import { describe, it, expect } from 'vitest'
import { useLoadout } from '../../../app/composables/useLoadout'
import type { ItemDef } from '../../../shared/types/items'

const mk = (id: string): ItemDef => ({ id, name: id, cost: 100, stats: {}, consumable: false })

describe('useLoadout', () => {
  it('starts empty and not full', () => {
    const lo = useLoadout(6)
    expect(lo.items.value).toEqual([])
    expect(lo.isFull.value).toBe(false)
    expect(lo.isSelected('a')).toBe(false)
  })

  it('toggle adds an item, toggle again removes it', () => {
    const lo = useLoadout(6)
    const a = mk('a')
    lo.toggle(a)
    expect(lo.items.value.map((i) => i.id)).toEqual(['a'])
    expect(lo.isSelected('a')).toBe(true)
    lo.toggle(a)
    expect(lo.items.value).toEqual([])
    expect(lo.isSelected('a')).toBe(false)
  })

  it('caps at maxSlots — adding beyond capacity is a no-op', () => {
    const lo = useLoadout(2)
    lo.toggle(mk('a'))
    lo.toggle(mk('b'))
    expect(lo.isFull.value).toBe(true)
    lo.toggle(mk('c')) // over cap
    expect(lo.items.value.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('frees a slot on removal so a new item can be added again', () => {
    const lo = useLoadout(2)
    const a = mk('a')
    lo.toggle(a)
    lo.toggle(mk('b'))
    expect(lo.isFull.value).toBe(true)
    lo.toggle(a) // remove a
    expect(lo.isFull.value).toBe(false)
    lo.toggle(mk('c')) // now fits
    expect(lo.items.value.map((i) => i.id)).toEqual(['b', 'c'])
  })

  it('does not add the same item twice (toggle is membership-based)', () => {
    const lo = useLoadout(6)
    const a = mk('a')
    lo.toggle(a)
    lo.toggle(a) // removes
    lo.toggle(a) // adds back once
    expect(lo.items.value.filter((i) => i.id === 'a')).toHaveLength(1)
  })

  it('clear empties the build', () => {
    const lo = useLoadout(6)
    lo.toggle(mk('a'))
    lo.toggle(mk('b'))
    lo.clear()
    expect(lo.items.value).toEqual([])
    expect(lo.isFull.value).toBe(false)
  })
})
