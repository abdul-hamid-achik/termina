import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../../../app/stores/game'
import { TICK_DURATION_MS } from '../../../shared/constants/balance'
import type { TickStateMessage } from '../../../shared/types/protocol'
import type { TeamState } from '../../../shared/types/game'

// ── Helpers ───────────────────────────────────────────────────────

function makeTeams(): { radiant: TeamState; dire: TeamState } {
  return {
    radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
  }
}

function makeTickMessage(tick: number): TickStateMessage {
  return {
    type: 'tick_state',
    tick,
    state: {
      phase: 'playing',
      players: {},
      zones: {},
      teams: makeTeams(),
    } as TickStateMessage['state'],
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Game Store — tick countdown', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('anchors the countdown when a tick arrives', () => {
    const store = useGameStore()

    store.updateFromTick(makeTickMessage(1))

    expect(store.lastTickAt).toBe(Date.now())
    expect(store.nextTickIn).toBe(TICK_DURATION_MS)
  })

  it('counts down as wall-clock time passes', () => {
    const store = useGameStore()
    store.updateFromTick(makeTickMessage(1))

    vi.advanceTimersByTime(1000)
    expect(store.nextTickIn).toBe(TICK_DURATION_MS - 1000)

    vi.advanceTimersByTime(1500)
    expect(store.nextTickIn).toBe(TICK_DURATION_MS - 2500)
  })

  it('clamps at zero when the tick is late', () => {
    const store = useGameStore()
    store.updateFromTick(makeTickMessage(1))

    vi.advanceTimersByTime(TICK_DURATION_MS + 2000)

    expect(store.nextTickIn).toBe(0)
  })

  it('re-anchors when the next tick arrives', () => {
    const store = useGameStore()
    store.updateFromTick(makeTickMessage(1))

    vi.advanceTimersByTime(3000)
    expect(store.nextTickIn).toBe(TICK_DURATION_MS - 3000)

    store.updateFromTick(makeTickMessage(2))
    expect(store.nextTickIn).toBe(TICK_DURATION_MS)
  })

  it('does not stack intervals across multiple ticks', () => {
    const store = useGameStore()
    store.updateFromTick(makeTickMessage(1))
    store.updateFromTick(makeTickMessage(2))
    store.updateFromTick(makeTickMessage(3))

    expect(vi.getTimerCount()).toBe(1)
  })

  it('stopTickCountdown halts and zeroes the countdown', () => {
    const store = useGameStore()
    store.updateFromTick(makeTickMessage(1))

    store.stopTickCountdown()

    expect(store.nextTickIn).toBe(0)
    expect(store.lastTickAt).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reset stops the countdown timer', () => {
    const store = useGameStore()
    store.updateFromTick(makeTickMessage(1))

    store.reset()

    expect(store.nextTickIn).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(2000)
    expect(store.nextTickIn).toBe(0)
  })
})

describe('Game Store — buffered command', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('buffers and consumes a command', () => {
    const store = useGameStore()

    store.bufferCommand('cast q')
    expect(store.bufferedCommand).toBe('cast q')

    expect(store.consumeBufferedCommand()).toBe('cast q')
    expect(store.bufferedCommand).toBeNull()
  })

  it('consume returns null when nothing is buffered', () => {
    const store = useGameStore()
    expect(store.consumeBufferedCommand()).toBeNull()
  })

  it('a newer buffered command replaces the previous one', () => {
    const store = useGameStore()

    store.bufferCommand('move mid-river')
    store.bufferCommand('attack hero:daemon')

    expect(store.consumeBufferedCommand()).toBe('attack hero:daemon')
  })

  it('survives tick updates (consumed by the screen, not the store)', () => {
    const store = useGameStore()

    store.bufferCommand('cast q')
    store.updateFromTick(makeTickMessage(5))

    expect(store.bufferedCommand).toBe('cast q')
    store.stopTickCountdown()
  })

  it('reset clears the buffer', () => {
    const store = useGameStore()

    store.bufferCommand('cast q')
    store.reset()

    expect(store.bufferedCommand).toBeNull()
  })
})
