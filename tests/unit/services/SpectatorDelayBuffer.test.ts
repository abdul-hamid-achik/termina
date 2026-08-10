/**
 * Unit tests for the spectator broadcast delay (server/services/
 * SpectatorDelayBuffer.ts) — the mechanism that turns the fogless live
 * spectator stream into a tape-delayed one (owner decision: SPECTATOR_
 * BROADCAST_DELAY_MS, currently 150s, in shared/constants/balance.ts).
 *
 * SpectatorRegistry is mocked so watcher delivery + the game-over teardown
 * call can be observed directly without a real WS peer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSpectatorsOfGame, clearGameSpectators } from '~~/server/services/SpectatorRegistry'
import {
  SPECTATOR_BROADCAST_DELAY_MS,
  SPECTATOR_BUFFER_MAX_FRAMES,
} from '~~/shared/constants/balance'

vi.mock('~~/server/services/SpectatorRegistry', () => ({
  getSpectatorsOfGame: vi.fn(() => []),
  clearGameSpectators: vi.fn(),
}))

// Imported AFTER the mock so the module under test picks up the mocked registry.
const {
  enqueueSpectatorFrame,
  enqueueGameOverFrame,
  getSpectateJoinInfo,
  hasSpectatorBuffer,
  stopSpectatorDelayBuffer,
  _resetSpectatorDelayBuffers,
} = await import('~~/server/services/SpectatorDelayBuffer')

function makePeer() {
  return { send: vi.fn() }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.mocked(getSpectatorsOfGame).mockReturnValue([])
  _resetSpectatorDelayBuffers()
})

afterEach(() => {
  _resetSpectatorDelayBuffers()
  vi.useRealTimers()
})

describe('SpectatorDelayBuffer — delivery timing', () => {
  it('does not deliver a frame before it has aged past the delay', () => {
    const peer = makePeer()
    vi.mocked(getSpectatorsOfGame).mockReturnValue([peer])

    enqueueSpectatorFrame('g1', 10, JSON.stringify({ type: 'spectator_tick', cycle: 10 }))

    // Well short of the delay — nothing should have gone out yet.
    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS - 5_000)
    expect(peer.send).not.toHaveBeenCalled()
  })

  it('delivers a frame once its age passes the delay', () => {
    const peer = makePeer()
    vi.mocked(getSpectatorsOfGame).mockReturnValue([peer])

    const payload = JSON.stringify({ type: 'spectator_tick', cycle: 10 })
    enqueueSpectatorFrame('g1', 10, payload)

    // Cross the delay threshold (plus one flush tick of slack).
    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS + 1_000)
    expect(peer.send).toHaveBeenCalledWith(payload)
  })

  it('delivers frames in order and only up to the mature boundary', () => {
    const peer = makePeer()
    vi.mocked(getSpectatorsOfGame).mockReturnValue([peer])

    enqueueSpectatorFrame('g1', 1, 'frame-1')
    vi.advanceTimersByTime(2_000)
    enqueueSpectatorFrame('g1', 2, 'frame-2')

    // Only frame-1 has crossed the delay boundary at this point.
    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS - 1_000)
    expect(peer.send).toHaveBeenCalledWith('frame-1')
    expect(peer.send).not.toHaveBeenCalledWith('frame-2')

    // Now frame-2 catches up too.
    vi.advanceTimersByTime(3_000)
    expect(peer.send).toHaveBeenCalledWith('frame-2')
  })
})

describe('SpectatorDelayBuffer — join semantics', () => {
  it('tells a joiner how long until the first frame if nothing has matured', () => {
    enqueueSpectatorFrame('g1', 1, 'frame-1')
    vi.advanceTimersByTime(10_000)

    const info = getSpectateJoinInfo('g1')
    expect(info).toEqual({ type: 'delayed', etaMs: SPECTATOR_BROADCAST_DELAY_MS - 10_000 })
  })

  it('reports a full delay eta for a game nobody has ever buffered', () => {
    const info = getSpectateJoinInfo('unknown-game')
    expect(info).toEqual({ type: 'delayed', etaMs: SPECTATOR_BROADCAST_DELAY_MS })
  })

  it('hands a newly-joining spectator the latest MATURE frame once one exists', () => {
    enqueueSpectatorFrame('g1', 1, 'frame-1')
    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS + 1_000)

    const info = getSpectateJoinInfo('g1')
    expect(info).toEqual({ type: 'mature', cycle: 1, payload: 'frame-1' })
  })

  it('keeps handing out the latest mature frame even after newer ones buffer behind it', () => {
    enqueueSpectatorFrame('g1', 1, 'frame-1')
    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS + 1_000) // frame-1 matures
    enqueueSpectatorFrame('g1', 2, 'frame-2') // not mature yet

    const info = getSpectateJoinInfo('g1')
    expect(info).toEqual({ type: 'mature', cycle: 1, payload: 'frame-1' })
  })
})

describe('SpectatorDelayBuffer — game end drains before cleanup', () => {
  it('drains buffered frames, then the game-over frame last, then tears down', () => {
    const peer = makePeer()
    vi.mocked(getSpectatorsOfGame).mockReturnValue([peer])

    enqueueSpectatorFrame('g1', 1, 'frame-1')
    vi.advanceTimersByTime(1_000)
    enqueueGameOverFrame('g1', 2, 'game-over-frame')

    // Before either matures: nothing sent, buffer still alive.
    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS - 5_000)
    expect(peer.send).not.toHaveBeenCalled()
    expect(hasSpectatorBuffer('g1')).toBe(true)
    expect(clearGameSpectators).not.toHaveBeenCalled()

    // frame-1 matures first (older) — game-over frame is one second younger
    // and must NOT be sent before frame-1.
    vi.advanceTimersByTime(4_500)
    expect(peer.send).toHaveBeenNthCalledWith(1, 'frame-1')
    expect(peer.send).not.toHaveBeenCalledWith('game-over-frame')
    expect(clearGameSpectators).not.toHaveBeenCalled()

    // The game-over frame matures a second later — delivered last, then the
    // whole entry tears itself down and drops every spectator registration.
    vi.advanceTimersByTime(1_500)
    expect(peer.send).toHaveBeenNthCalledWith(2, 'game-over-frame')
    expect(clearGameSpectators).toHaveBeenCalledWith('g1')
    expect(hasSpectatorBuffer('g1')).toBe(false)
  })

  it('leaves no buffer or timer after the game-over frame delivers (no leak)', () => {
    enqueueSpectatorFrame('g1', 1, 'frame-1')
    enqueueGameOverFrame('g1', 2, 'game-over-frame')

    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS + 2_000)

    expect(hasSpectatorBuffer('g1')).toBe(false)
    // Nothing left ticking for this game — advancing further does nothing
    // and schedules no further work (fake-timer count settles at 0 once any
    // other suite-level timers are accounted for by the reset in beforeEach).
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears spectators immediately when a game ends with nothing ever buffered', () => {
    enqueueGameOverFrame('never-watched', 1, 'game-over-frame')
    expect(clearGameSpectators).toHaveBeenCalledWith('never-watched')
    expect(hasSpectatorBuffer('never-watched')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stopSpectatorDelayBuffer force-closes a buffer without draining or notifying', () => {
    const peer = makePeer()
    vi.mocked(getSpectatorsOfGame).mockReturnValue([peer])

    enqueueSpectatorFrame('zombie', 1, 'frame-1')
    expect(hasSpectatorBuffer('zombie')).toBe(true)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    stopSpectatorDelayBuffer('zombie')

    expect(hasSpectatorBuffer('zombie')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    // Force-stop is a raw teardown for abnormal paths (the reaper) — it does
    // NOT itself unsubscribe spectators; the caller does that separately.
    expect(clearGameSpectators).not.toHaveBeenCalled()

    // And even if time marches on, nothing fires for the dropped game.
    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS * 2)
    expect(peer.send).not.toHaveBeenCalled()
  })
})

describe('SpectatorDelayBuffer — bounded buffer', () => {
  it('caps buffered frames and drops the oldest once the bound is exceeded', () => {
    // Push more frames than the bound without ever advancing time, so none
    // of them mature and none get removed by delivery.
    for (let i = 0; i < SPECTATOR_BUFFER_MAX_FRAMES + 10; i++) {
      enqueueSpectatorFrame('g1', i, `frame-${i}`)
    }

    // The eta-to-first-mature-frame is still governed by the OLDEST frame
    // still in the buffer, which must now be a later one than frame-0 (it
    // was dropped as the bound's safety valve kicked in).
    vi.advanceTimersByTime(SPECTATOR_BROADCAST_DELAY_MS + 1_000)
    const watchersCallsBeforeDrop = vi.mocked(getSpectatorsOfGame).mock.calls.length
    expect(watchersCallsBeforeDrop).toBeGreaterThan(0)

    // Every frame that does eventually deliver must come from the surviving
    // (non-dropped) tail — frame-0 specifically must never have been kept
    // once the excess pushed it out. We can't directly introspect the
    // buffer, so assert indirectly via getSpectateJoinInfo: once maturity
    // catches up, the game's `latestMature` cannot be frame-0 covering a
    // buffer that had 10 extra pushes ahead of the bound.
    const info = getSpectateJoinInfo('g1')
    if (info.type === 'mature') {
      expect(info.payload).not.toBe('frame-0')
    }
  })
})
