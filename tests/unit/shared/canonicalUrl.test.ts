import { describe, expect, it } from 'vitest'
import { canonicalUrl } from '../../../shared/constants/site'

describe('canonicalUrl', () => {
  it('uses the www host and keeps the home page as a bare slash', () => {
    expect(canonicalUrl('/')).toBe('https://www.terminamoba.com/')
    expect(canonicalUrl('')).toBe('https://www.terminamoba.com/')
  })
  it('strips query, hash and trailing slashes', () => {
    expect(canonicalUrl('/cast?hero=daemon')).toBe('https://www.terminamoba.com/cast')
    expect(canonicalUrl('/lore#beat')).toBe('https://www.terminamoba.com/lore')
    expect(canonicalUrl('/items/')).toBe('https://www.terminamoba.com/items')
  })
})
