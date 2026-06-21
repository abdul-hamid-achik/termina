import { describe, it, expect } from 'vitest'
import { formatTickClock, formatSeconds } from '../../../app/utils/gameClock'

describe('formatTickClock', () => {
  it('formats ticks as M:SS (unpadded minutes) by default', () => {
    expect(formatTickClock(0)).toBe('0:00')
    expect(formatTickClock(15)).toBe('1:00') // 15 ticks * 4s = 60s
    expect(formatTickClock(1)).toBe('0:04')
    expect(formatTickClock(2)).toBe('0:08')
    expect(formatTickClock(150)).toBe('10:00') // 600s
  })

  it('pads minutes to MM:SS when padMinutes is true', () => {
    expect(formatTickClock(0, true)).toBe('00:00')
    expect(formatTickClock(15, true)).toBe('01:00')
    expect(formatTickClock(150, true)).toBe('10:00')
  })

  it('zero-pads the seconds in both modes', () => {
    expect(formatTickClock(16)).toBe('1:04') // 64s -> 1:04
    expect(formatTickClock(16, true)).toBe('01:04')
  })

  it('handles long games (minutes spill past 60)', () => {
    expect(formatTickClock(1000)).toBe('66:40') // 4000s
    expect(formatTickClock(1000, true)).toBe('66:40')
  })
})

describe('formatSeconds', () => {
  it('formats seconds as M:SS (unpadded minutes) by default', () => {
    expect(formatSeconds(0)).toBe('0:00')
    expect(formatSeconds(5)).toBe('0:05')
    expect(formatSeconds(65)).toBe('1:05')
    expect(formatSeconds(600)).toBe('10:00')
  })

  it('pads minutes to MM:SS when requested', () => {
    expect(formatSeconds(0, true)).toBe('00:00')
    expect(formatSeconds(65, true)).toBe('01:05')
  })
})
