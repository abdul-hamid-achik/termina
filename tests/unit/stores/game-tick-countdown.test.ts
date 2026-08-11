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

function makeCycleMessage(cycle: number, nextCommitAt?: number): CycleStateMessage {
  return {
    type: 'cycle_state',
    cycle,
    // `nextCommitAt` is a top-level CycleStateMessage field (the server's
    // batch-commit epoch) — NOT part of the PlayerVisibleState `state` payload.
    ...(nextCommitAt !== undefined ? { nextCommitAt } : {}),
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

describe('Game Store — persistent cycle clock (nextCommitAt / orderCommitted)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads nextCommitAt straight from the cycle_state payload when present', () => {
    const store = useGameStore()
    const serverCommitAt = Date.now() + 1234

    store.updateFromCycle(makeCycleMessage(1, serverCommitAt))

    expect(store.nextCommitAt).toBe(serverCommitAt)
  })

  it('falls back to arrival time + CYCLE_DURATION_MS when the payload omits it', () => {
    const store = useGameStore()

    store.updateFromCycle(makeCycleMessage(1))

    expect(store.nextCommitAt).toBe(Date.now() + CYCLE_DURATION_MS)
  })

  it('starts with orderCommitted false and markOrderCommitted flips it true', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))
    expect(store.orderCommitted).toBe(false)

    store.markOrderCommitted()

    expect(store.orderCommitted).toBe(true)
  })

  it('resets orderCommitted to false when a NEW cycle number arrives', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))
    store.markOrderCommitted()
    expect(store.orderCommitted).toBe(true)

    store.updateFromCycle(makeCycleMessage(2))

    expect(store.orderCommitted).toBe(false)
  })

  it('does NOT reset orderCommitted on a repeat delta for the SAME cycle', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))
    store.markOrderCommitted()

    // Another cycle_state for the identical cycle number (e.g. a resend) must
    // not silently un-commit an order the player already queued.
    store.updateFromCycle(makeCycleMessage(1))

    expect(store.orderCommitted).toBe(true)
  })

  it('markActionSent on the main slot optimistically commits the order', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(5))
    expect(store.orderCommitted).toBe(false)

    store.markActionSent('move coldstore-cross')

    expect(store.orderCommitted).toBe(true)
  })

  it('markActionSent on the item slot does NOT commit the main order', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(5))

    store.markActionSent('use jump_shunt coldstore-cross', 'item')

    expect(store.orderCommitted).toBe(false)
  })

  it('stopTickCountdown and reset clear nextCommitAt', () => {
    const store = useGameStore()
    store.updateFromCycle(makeCycleMessage(1))
    expect(store.nextCommitAt).not.toBeNull()

    store.stopTickCountdown()
    expect(store.nextCommitAt).toBeNull()

    store.updateFromCycle(makeCycleMessage(2))
    store.markOrderCommitted()
    store.reset()
    expect(store.nextCommitAt).toBeNull()
    expect(store.orderCommitted).toBe(false)
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
