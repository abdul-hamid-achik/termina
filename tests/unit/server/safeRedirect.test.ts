import { describe, it, expect } from 'vitest'
import { safeRedirect } from '~~/server/utils/safeRedirect'

describe('safeRedirect', () => {
  it('allows same-origin paths', () => {
    expect(safeRedirect('/lobby')).toBe('/lobby')
    expect(safeRedirect('/profile/settings')).toBe('/profile/settings')
  })

  it('rejects open redirects', () => {
    expect(safeRedirect('//evil.com')).toBe('/')
    expect(safeRedirect('/\\evil.com')).toBe('/')
    expect(safeRedirect('https://evil.com')).toBe('/')
    expect(safeRedirect('')).toBe('/')
  })
})
