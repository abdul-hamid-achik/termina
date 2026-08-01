import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '~~/app/stores/game'
import { CYCLE_DURATION_MS } from '~~/shared/constants/balance'
import type { CycleStateMessage } from '~~/shared/types/protocol'
import type { TeamState } from '~~/shared/types/game'

// ── Helpers ───────────────────────────────────────────────────────

function makeTeams(): { chaff: TeamState; audit: TeamState } {
  return {
    chaff: { id: 'chaff', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
    audit: { id: 'audit', kills: 0, iceKills: 0, scrip: 0, hardenUsedCycle: null },
  }
}

function makeCycleMessage(cycle: number): CycleStateMessage {
  return {
    type: 'cycle_state',
    cycle,
    state: {
      phase: 'playing',
      players: {},
      zones: {},
      teams: makeTeams(),
    } as CycleStateMessage['state'],
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Game Store — cycle countdown', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('anchors the countdown when a cycle arrives', () => {
    const store = useGameStore()

    store.updateFromCycle(makeCycleMessage(1))

    expect(store.lastCycleAt).toBe(Date.now())
    expect(store.nextCycleIn).toBe(CYCLE_DURATION_MS)
  })

  it('counts down as wall-clock time passes', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))

    vi.advanceTimersByTime(1000)
    expect(store.nextCycleIn).toBe(CYCLE_DURATION_MS - 1000)

    vi.advanceTimersByTime(1500)
    expect(store.nextCycleIn).toBe(CYCLE_DURATION_MS - 2500)
  })

  it('clamps at zero when the cycle is late', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))

    vi.advanceTimersByTime(CYCLE_DURATION_MS + 2000)

    expect(store.nextCycleIn).toBe(0)
  })

  it('re-anchors when the next cycle arrives', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))

    vi.advanceTimersByTime(3000)
    expect(store.nextCycleIn).toBe(CYCLE_DURATION_MS - 3000)

    store.updateFromCycle(makeCycleMessage(2))
    expect(store.nextCycleIn).toBe(CYCLE_DURATION_MS)
  })

  it('does not stack intervals across multiple ticks', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))
    store.updateFromCycle(makeCycleMessage(2))
    store.updateFromCycle(makeCycleMessage(3))

    expect(vi.getTimerCount()).toBe(1)
  })

  it('stopTickCountdown halts and zeroes the countdown', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))

    store.stopTickCountdown()

    expect(store.nextCycleIn).toBe(0)
    expect(store.lastCycleAt).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reset stops the countdown timer', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))

    store.reset()

    expect(store.nextCycleIn).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(2000)
    expect(store.nextCycleIn).toBe(0)
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

    store.bufferCommand('move coldstore-cross')
    store.bufferCommand('attack hero:daemon')

    expect(store.consumeBufferedCommand()).toBe('attack hero:daemon')
  })

  it('survives cycle updates (consumed by the screen, not the store)', () => {
    const store = useGameStore()

    store.bufferCommand('cast q')
    store.updateFromCycle(makeCycleMessage(5))

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
