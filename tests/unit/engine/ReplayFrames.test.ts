import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { processCycle, submitAction } from '~~/server/game/engine/GameLoop'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'

/**
 * The replay step-through endpoint replays the persisted action log through
 * processCycle to reconstruct per-cycle state. This test exercises the same
 * loop without going through the HTTP layer so we have coverage independent
 * of the Nitro runtime.
 *
 * The invariant we care about: replaying a recorded buy action reproduces
 * the scrip + inventory change at the right tick index, with no bot AI
 * leaking into the replay (because `registerBots` was never called).
 */

describe('replay frames reconstruction', () => {
  it('rebuilds per-cycle player state by replaying actions through processCycle', async () => {
    const sm = createInMemoryStateManager()
    const gameId = 'replay_test_1'
    const setup = [
      { id: 'p1', name: 'p1', team: 'chaff' as const, heroId: 'echo' },
      { id: 'p2', name: 'p2', team: 'audit' as const, heroId: 'daemon' },
    ]
    await Effect.runPromise(sm.createGame(gameId, setup))
    await Effect.runPromise(sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })))

    const initial = await Effect.runPromise(sm.getState(gameId))
    const startGold = initial.players.p1!.scrip

    // Tick 1: p1 buys an scrap_lot from the fountain.
    submitAction(gameId, 'p1', { type: 'buy', item: 'scrap_lot' })
    const t1 = await Effect.runPromise(processCycle(gameId, initial))
    await Effect.runPromise(sm.updateState(gameId, () => t1.state))
    expect(t1.state.cycle).toBe(1)
    expect(t1.state.players.p1!.scrip).toBeLessThan(startGold)
    expect(t1.state.players.p1!.items.includes('scrap_lot')).toBe(true)

    // Tick 2: no actions — state mostly carries forward (passive scrip may
    // tick up; we only assert the buy persisted).
    const t2 = await Effect.runPromise(processCycle(gameId, t1.state))
    expect(t2.state.cycle).toBe(2)
    expect(t2.state.players.p1!.items.includes('scrap_lot')).toBe(true)

    // Tick 3: p1 sells the branch (the queued command is keyed by item id,
    // not slot — see ActionResolver.resolveActions's sell phase).
    submitAction(gameId, 'p1', { type: 'sell', item: 'scrap_lot' })
    const t3 = await Effect.runPromise(processCycle(gameId, t2.state))
    expect(t3.state.cycle).toBe(3)
    expect(t3.state.players.p1!.items.includes('scrap_lot')).toBe(false)
  })

  it('does not inject bot actions when no bots are registered for the replay gameId', async () => {
    // The replay endpoint uses a fresh gameId and never calls registerBots,
    // which means processCycle's bot-AI block reads an empty bot list. This
    // is what keeps the replay deterministic with respect to the recorded
    // action log.
    const sm = createInMemoryStateManager()
    const gameId = 'replay_test_2'
    const setup = [
      { id: 'human', name: 'human', team: 'chaff' as const, heroId: 'echo' },
      { id: 'bot_x', name: 'bot_x', team: 'audit' as const, heroId: 'daemon' },
    ]
    await Effect.runPromise(sm.createGame(gameId, setup))
    await Effect.runPromise(sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })))
    const initial = await Effect.runPromise(sm.getState(gameId))

    const result = await Effect.runPromise(processCycle(gameId, initial))
    // No bot_x action in the action log, no registerBots call → zero player
    // commands processed.
    const botCommandsExecuted = result.actions.filter((a) => a.playerId === 'bot_x')
    expect(botCommandsExecuted).toHaveLength(0)
  })
})
