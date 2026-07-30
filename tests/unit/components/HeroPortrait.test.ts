import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HeroPortrait from '~~/app/components/avatars/HeroPortrait.vue'

// happy-dom does not load images — assert the resolved src + alt contract and
// the 64-vs-512 variant switch, not pixels.
describe('HeroPortrait', () => {
  it('resolves the 64px variant below 96px', () => {
    const w = mount(HeroPortrait, { props: { heroId: 'echo', size: 48 } })
    expect(w.get('img').attributes('src')).toBe('/portraits/64/echo.webp')
  })

  it('resolves the 512px variant at or above 96px', () => {
    const w = mount(HeroPortrait, { props: { heroId: 'echo', size: 512 } })
    expect(w.get('img').attributes('src')).toBe('/portraits/echo.webp')
  })

  it('alt text carries the operator real name and the hero name', () => {
    const w = mount(HeroPortrait, { props: { heroId: 'echo' } })
    expect(w.get('img').attributes('alt')).toBe('Rosane Vieira — Echo')
  })

  it('falls back to the raw id alt for an unknown hero', () => {
    const w = mount(HeroPortrait, { props: { heroId: 'ghost_99' } })
    expect(w.get('img').attributes('alt')).toBe('ghost_99')
  })

  it('sets explicit width/height, lazy loading and async decoding', () => {
    const w = mount(HeroPortrait, { props: { heroId: 'daemon', size: 32 } })
    const img = w.get('img')
    expect(img.attributes('width')).toBe('32')
    expect(img.attributes('height')).toBe('32')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('decoding')).toBe('async')
  })
})
