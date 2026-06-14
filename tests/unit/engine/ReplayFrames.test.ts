import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { processTick, submitAction } from '~~/server/game/engine/GameLoop'
import { createInMemoryStateManager } from '~~/server/game/engine/StateManager'

/**
 * The replay step-through endpoint replays the persisted action log through
 * processTick to reconstruct per-tick state. This test exercises the same
 * loop without going through the HTTP layer so we have coverage independent
 * of the Nitro runtime.
 *
 * The invariant we care about: replaying a recorded buy action reproduces
 * the gold + inventory change at the right tick index, with no bot AI
 * leaking into the replay (because `registerBots` was never called).
 */

describe('replay frames reconstruction', () => {
  it('rebuilds per-tick player state by replaying actions through processTick', async () => {
    const sm = createInMemoryStateManager()
    const gameId = 'replay_test_1'
    const setup = [
      { id: 'p1', name: 'p1', team: 'radiant' as const, heroId: 'echo' },
      { id: 'p2', name: 'p2', team: 'dire' as const, heroId: 'daemon' },
    ]
    await Effect.runPromise(sm.createGame(gameId, setup))
    await Effect.runPromise(sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })))

    const initial = await Effect.runPromise(sm.getState(gameId))
    const startGold = initial.players.p1!.gold

    // Tick 1: p1 buys an iron_branch from the fountain.
    submitAction(gameId, 'p1', { type: 'buy', item: 'iron_branch' })
    const t1 = await Effect.runPromise(processTick(gameId, initial))
    await Effect.runPromise(sm.updateState(gameId, () => t1.state))
    expect(t1.state.tick).toBe(1)
    expect(t1.state.players.p1!.gold).toBeLessThan(startGold)
    expect(t1.state.players.p1!.items.includes('iron_branch')).toBe(true)

    // Tick 2: no actions — state mostly carries forward (passive gold may
    // tick up; we only assert the buy persisted).
    const t2 = await Effect.runPromise(processTick(gameId, t1.state))
    expect(t2.state.tick).toBe(2)
    expect(t2.state.players.p1!.items.includes('iron_branch')).toBe(true)

    // Tick 3: p1 sells the branch (the queued command is keyed by item id,
    // not slot — see ActionResolver.resolveActions's sell phase).
    submitAction(gameId, 'p1', { type: 'sell', item: 'iron_branch' })
    const t3 = await Effect.runPromise(processTick(gameId, t2.state))
    expect(t3.state.tick).toBe(3)
    expect(t3.state.players.p1!.items.includes('iron_branch')).toBe(false)
  })

  it('does not inject bot actions when no bots are registered for the replay gameId', async () => {
    // The replay endpoint uses a fresh gameId and never calls registerBots,
    // which means processTick's bot-AI block reads an empty bot list. This
    // is what keeps the replay deterministic with respect to the recorded
    // action log.
    const sm = createInMemoryStateManager()
    const gameId = 'replay_test_2'
    const setup = [
      { id: 'human', name: 'human', team: 'radiant' as const, heroId: 'echo' },
      { id: 'bot_x', name: 'bot_x', team: 'dire' as const, heroId: 'daemon' },
    ]
    await Effect.runPromise(sm.createGame(gameId, setup))
    await Effect.runPromise(sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })))
    const initial = await Effect.runPromise(sm.getState(gameId))

    const result = await Effect.runPromise(processTick(gameId, initial))
    // No bot_x action in the action log, no registerBots call → zero player
    // commands processed.
    const botCommandsExecuted = result.actions.filter((a) => a.playerId === 'bot_x')
    expect(botCommandsExecuted).toHaveLength(0)
  })
})
