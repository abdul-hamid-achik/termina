import { describe, it, expect } from 'vitest'
import { reconnectDelay } from '../../../app/utils/reconnect'

describe('reconnectDelay', () => {
  it('doubles each attempt starting from the base interval', () => {
    expect(reconnectDelay(0)).toBe(1000)
    expect(reconnectDelay(1)).toBe(2000)
    expect(reconnectDelay(2)).toBe(4000)
    expect(reconnectDelay(3)).toBe(8000)
    expect(reconnectDelay(4)).toBe(16_000)
  })

  it('caps at maxMs (default 30s)', () => {
    // 2^5 * 1000 = 32000 → capped to 30000, and stays there
    expect(reconnectDelay(5)).toBe(30_000)
    expect(reconnectDelay(10)).toBe(30_000)
    expect(reconnectDelay(50)).toBe(30_000)
  })

  it('treats negative attempts as the first attempt (no sub-base delay)', () => {
    expect(reconnectDelay(-1)).toBe(1000)
    expect(reconnectDelay(-99)).toBe(1000)
  })

  it('honours custom base and cap', () => {
    expect(reconnectDelay(0, 500, 8000)).toBe(500)
    expect(reconnectDelay(2, 500, 8000)).toBe(2000)
    expect(reconnectDelay(5, 500, 8000)).toBe(8000) // 500*32=16000 → capped
  })
})
