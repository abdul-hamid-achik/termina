import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PartyPanel from '~~/app/components/lobby/PartyPanel.vue'

const stubs = {
  TerminalPanel: { name: 'TerminalPanel', template: '<section><slot /></section>' },
  AsciiButton: {
    name: 'AsciiButton',
    props: ['label', 'variant', 'disabled'],
    emits: ['click'],
    template: `<button :disabled="disabled" @click="$emit('click', $event)">{{ label }}</button>`,
  },
}

const PARTY = {
  code: 'ABCDE',
  leaderId: 'lead',
  createdAt: 0,
  members: [
    { playerId: 'lead', username: 'lead', mmr: 1000 },
    { playerId: 'me', username: 'me', mmr: 1000 },
  ],
}

let partyResponse: typeof PARTY | null
let queueStatus: { status: string; gameId?: string }
const fetchMock = vi.fn(async (url: string) => {
  if (url === '/api/party/status') return { party: partyResponse }
  if (url === '/api/queue/status-neon') return queueStatus
  throw new Error(`unexpected ${url}`)
})

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockClear()
  partyResponse = PARTY
  queueStatus = { status: 'idle' }
  vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mountPanel = () => mount(PartyPanel, { props: { myPlayerId: 'me' }, global: { stubs } })

describe('PartyPanel — a non-leader member follows the leader into the game', () => {
  it('routes the member to the game when the party disappears and a live game exists', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-testid="party-code"]').exists()).toBe(true)

    // Leader starts co-op: the party row is gone, and the member's game exists.
    partyResponse = null
    queueStatus = { status: 'found', gameId: 'g_coop' }
    await vi.advanceTimersByTimeAsync(10_000)
    await flushPromises()

    expect(wrapper.emitted('started')).toEqual([['g_coop']])
    wrapper.unmount()
  })

  it('keeps looking for a few polls when the game is not created yet, then finds it', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    partyResponse = null
    queueStatus = { status: 'idle' }
    await vi.advanceTimersByTimeAsync(10_000)
    await flushPromises()
    expect(wrapper.emitted('started')).toBeUndefined()

    queueStatus = { status: 'found', gameId: 'g_late' }
    await vi.advanceTimersByTimeAsync(2_000)
    await flushPromises()
    expect(wrapper.emitted('started')).toEqual([['g_late']])
    wrapper.unmount()
  })

  it('gives up (no emit) when no game ever appears', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    partyResponse = null
    await vi.advanceTimersByTimeAsync(10_000 + 6 * 2_000 + 2_000)
    await flushPromises()
    expect(wrapper.emitted('started')).toBeUndefined()
    const lookups = fetchMock.mock.calls.filter(([u]) => u === '/api/queue/status-neon').length
    expect(lookups).toBeLessThanOrEqual(6)
    wrapper.unmount()
  })

  it('does NOT go looking for a game when the member never had a party', async () => {
    partyResponse = null
    const wrapper = mountPanel()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/queue/status-neon')).toBe(false)
    wrapper.unmount()
  })
})
