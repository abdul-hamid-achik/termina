import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import {
  createInMemoryStateManager,
  type PlayerSetup,
  type StateManagerApi,
} from '~~/server/game/engine/StateManager'
import { processTick, submitAction } from '~~/server/game/engine/GameLoop'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import { buyItem, sellItem } from '~~/server/game/items/shop'
import { getItem } from '~~/server/game/items/registry'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import {
  KILL_BOUNTY_BASE,
  ASSIST_GOLD,
  PASSIVE_GOLD_PER_TICK,
  SURRENDER_MIN_TICK,
  COMEBACK_BONUS_MAX,
  COMEBACK_PENALTY_MAX,
} from '~~/shared/constants/balance'
import { HERO_IDS } from '~~/shared/constants/heroes'

/**
 * Integration tests for the game lifecycle, driven through the REAL engine
 * (`createInMemoryStateManager` + `submitAction` + `processTick`) — the same
 * pipeline `scripts/simulate-game.ts` uses for full bot matches.
 *
 * NOTE: These tests deliberately avoid importing `server/plugins/game-server.ts`
 * because that module's default export is a `defineNitroPlugin(...)` call,
 * which is only resolvable inside the Nitro runtime — vitest can't load it.
 * Cross-cutting flows that need the plugin (matchmaking → game_ready → game
 * start) live in tests/e2e under Playwright instead. This file covers what
 * can be tested with the bare engine + state manager.
 *
 * Flows that do NOT exist at this layer (and where they ARE tested):
 * - Player disconnect/reconnect: handled at the WS boundary
 *   (server/routes/ws.ts + PeerRegistry). Covered by
 *   tests/unit/services/PeerRegistry.test.ts and the live-socket round-trips
 *   in tests/integration/websocket-service.test.ts.
 * - Action rate limiting: enforced per-connection in server/routes/ws.ts via
 *   server/utils/RateLimiter.ts before commands ever reach the engine (the
 *   engine itself dedupes to one action per player per tick). Covered by
 *   tests/unit/utils/RateLimiter.test.ts.
 */

// Unique ids per test so module-level engine state (action queues, assist
// tracking keyed by gameId; vision cache keyed by playerId) never bleeds
// between tests.
let gameSeq = 0
function uid(label: string): string {
  return `gfit_${label}_${gameSeq++}`
}

async function startGame(gameId: string, players: PlayerSetup[]): Promise<StateManagerApi> {
  const sm = createInMemoryStateManager()
  await Effect.runPromise(sm.createGame(gameId, players))
  await Effect.runPromise(sm.updateState(gameId, (s) => ({ ...s, phase: 'playing' as const })))
  return sm
}

/** Run one engine tick and persist the result, mirroring the real game loop. */
async function runTick(sm: StateManagerApi, gameId: string) {
  const state = await Effect.runPromise(sm.getState(gameId))
  const result = await Effect.runPromise(processTick(gameId, state))
  await Effect.runPromise(sm.updateState(gameId, () => result.state))
  return result
}

function arrange(
  sm: StateManagerApi,
  gameId: string,
  fn: (s: GameState) => GameState,
): Promise<GameState> {
  return Effect.runPromise(sm.updateState(gameId, fn))
}

function setPlayer(state: GameState, id: string, patch: Partial<PlayerState>): GameState {
  const player = state.players[id]
  if (!player) throw new Error(`No such player in fixture: ${id}`)
  return { ...state, players: { ...state.players, [id]: { ...player, ...patch } } }
}

/** Fountain healing/regen is skipped while inCombat — used to freeze HP/MP. */
function inCombatBuff() {
  return { id: 'inCombat', stacks: 1, ticksRemaining: 3, source: 'system' }
}

function makePlayers(prefix: string, perTeam: number): PlayerSetup[] {
  const radiant = Array.from({ length: perTeam }, (_, i) => ({
    id: `${prefix}_r${i}`,
    name: `${prefix}_r${i}`,
    team: 'radiant' as const,
    heroId: HERO_IDS[i]!,
  }))
  const dire = Array.from({ length: perTeam }, (_, i) => ({
    id: `${prefix}_d${i}`,
    name: `${prefix}_d${i}`,
    team: 'dire' as const,
    heroId: HERO_IDS[perTeam + i]!,
  }))
  return [...radiant, ...dire]
}

describe('Game Flow Integration', () => {
  describe('Full Game Lifecycle', () => {
    it('completes a full game — destroying the enemy Ancient ends it', async () => {
      const gameId = uid('full')
      const sm = await startGame(gameId, makePlayers('fg', 1))

      // Arrange the end-game: a dire T3 tower is already down (which makes
      // the dire Ancient vulnerable), the radiant hero has sieged into the
      // enemy base, and the Ancient is low so the test stays fast.
      await arrange(sm, gameId, (s) => {
        const sieged = setPlayer(s, 'fg_r0', { zone: 'dire-base' })
        return {
          ...sieged,
          towers: sieged.towers.map((t) =>
            t.zone === 'mid-t3-dire' ? { ...t, alive: false, hp: 0 } : t,
          ),
          ancients: {
            ...sieged.ancients,
            dire: { ...sieged.ancients.dire, hp: 400 },
          },
        }
      })

      const allEvents: GameEngineEvent[] = []
      let final: GameState | null = null
      for (let i = 0; i < 60; i++) {
        submitAction(gameId, 'fg_r0', { type: 'attack', target: { kind: 'ancient' } })
        const result = await runTick(sm, gameId)
        allEvents.push(...result.events)
        final = result.state
        if (i === 0) {
          // The engine recomputed vulnerability from the dead T3 tower
          expect(result.state.ancients.dire.vulnerable).toBe(true)
        }
        if (result.state.phase === 'ended') break
      }

      expect(final).not.toBeNull()
      const endState = final!
      expect(endState.phase).toBe('ended')
      expect(endState.winner).toBe('radiant')
      expect(endState.ancients.dire.alive).toBe(false)
      expect(endState.ancients.dire.hp).toBe(0)
      expect(endState.ancients.radiant.alive).toBe(true)

      // Hero damage was routed to the Ancient and its destruction was
      // announced (tower_kill in the base zone is the structure-down event).
      expect(
        allEvents.some((e) => e._tag === 'damage' && e.targetId === 'ancient_dire'),
      ).toBe(true)
      expect(
        allEvents.some(
          (e) => e._tag === 'tower_kill' && e.zone === 'dire-base' && e.killerTeam === 'radiant',
        ),
      ).toBe(true)
    })

    it('handles surrender vote — passes at the 60% threshold, not below', async () => {
      const gameId = uid('ff')
      const sm = await startGame(gameId, makePlayers('ff', 5))
      // Surrender opens at SURRENDER_MIN_TICK; jump straight past the gate
      await arrange(sm, gameId, (s) => ({ ...s, tick: SURRENDER_MIN_TICK }))

      // 2 of 5 alive players = 40% — below the 60% threshold (needs 3)
      submitAction(gameId, 'ff_r0', { type: 'surrender', vote: 'yes' })
      submitAction(gameId, 'ff_r1', { type: 'surrender', vote: 'yes' })
      let result = await runTick(sm, gameId)

      expect(result.state.phase).toBe('playing')
      expect(result.state.surrenderVotes.radiant.size).toBe(2)
      const voteEvents = result.events.filter((e) => e._tag === 'surrender_vote')
      expect(voteEvents).toHaveLength(2)
      expect(voteEvents.at(-1)).toMatchObject({ votesFor: 2, votesNeeded: 3 })

      // Third vote tips it over the threshold — radiant forfeits, dire wins
      submitAction(gameId, 'ff_r2', { type: 'surrender', vote: 'yes' })
      result = await runTick(sm, gameId)

      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('dire')
      expect(
        result.events.some(
          (e) => e._tag === 'surrendered' && e.team === 'radiant' && e.winner === 'dire',
        ),
      ).toBe(true)
    })
  })

  describe('Gold Distribution Integration', () => {
    it('distributes gold correctly in a team fight (killer bounty + assist pot, no double-dip)', async () => {
      const gameId = uid('tf')
      const sm = await startGame(gameId, makePlayers('tf', 2))
      // killer + assister + victim share a zone; the 2nd dire player idles in
      // the fountain keeping team net-worths balanced (comeback multiplier ≈ 1)
      await arrange(sm, gameId, (s) => {
        let next = setPlayer(s, 'tf_r0', { zone: 'mid-river' })
        next = setPlayer(next, 'tf_r1', { zone: 'mid-river' })
        next = setPlayer(next, 'tf_d0', { zone: 'mid-river' })
        return next
      })

      // Tick 1: the assister softens the victim — this damage registers in
      // the engine's assist window.
      submitAction(gameId, 'tf_r1', { type: 'attack', target: { kind: 'hero', name: 'tf_d0' } })
      const r1 = await runTick(sm, gameId)
      const softened = r1.state.players['tf_d0']!
      expect(softened.hp).toBeLessThan(softened.maxHp)
      expect(softened.alive).toBe(true)

      // Arrange a lethal blow, snapshot gold, then the killer finishes
      await arrange(sm, gameId, (s) => setPlayer(s, 'tf_d0', { hp: 1 }))
      const before = await Effect.runPromise(sm.getState(gameId))

      submitAction(gameId, 'tf_r0', { type: 'attack', target: { kind: 'hero', name: 'tf_d0' } })
      const r2 = await runTick(sm, gameId)
      const after = r2.state

      // Scoreboard counters
      expect(after.players['tf_d0']!.alive).toBe(false)
      expect(after.players['tf_d0']!.deaths).toBe(1)
      expect(after.players['tf_r0']!.kills).toBe(1)
      expect(after.players['tf_r1']!.assists).toBe(1)
      expect(after.teams.radiant.kills).toBe(1)

      // Kill event credits exactly one killer and one assister
      const killEvent = r2.events.find((e) => e._tag === 'kill')
      expect(killEvent).toMatchObject({
        killerId: 'tf_r0',
        victimId: 'tf_d0',
        assisters: ['tf_r1'],
      })

      const killerDelta = after.players['tf_r0']!.gold - before.players['tf_r0']!.gold
      const assistDelta = after.players['tf_r1']!.gold - before.players['tf_r1']!.gold
      const victimDelta = after.players['tf_d0']!.gold - before.players['tf_d0']!.gold

      // Killer: base bounty (victim streak 0, balanced net-worths → ×1)
      // plus this tick's passive gold. NOT the assist pot too.
      expect(killerDelta).toBe(KILL_BOUNTY_BASE + PASSIVE_GOLD_PER_TICK)
      // Sole assister collects the full assist pot plus passive gold.
      expect(assistDelta).toBe(ASSIST_GOLD + PASSIVE_GOLD_PER_TICK)
      // The dead victim earns nothing this tick.
      expect(victimDelta).toBe(0)
    })

    it('handles multi-kill gold distribution — consecutive kills build streak, each pays a bounty', async () => {
      const gameId = uid('mk')
      const sm = await startGame(gameId, makePlayers('mk', 2))
      await arrange(sm, gameId, (s) => {
        let next = setPlayer(s, 'mk_r0', { zone: 'mid-river' })
        next = setPlayer(next, 'mk_d0', { zone: 'mid-river', hp: 1 })
        next = setPlayer(next, 'mk_d1', { zone: 'mid-river' })
        return next
      })

      // Each kill bounty is KILL_BOUNTY_BASE scaled by the comeback
      // multiplier; assert within its exact envelope.
      const minBounty = Math.round(KILL_BOUNTY_BASE * (1 - COMEBACK_PENALTY_MAX))
      const maxBounty = Math.round(KILL_BOUNTY_BASE * (1 + COMEBACK_BONUS_MAX))

      // Kill #1
      const before1 = await Effect.runPromise(sm.getState(gameId))
      submitAction(gameId, 'mk_r0', { type: 'attack', target: { kind: 'hero', name: 'mk_d0' } })
      const r1 = await runTick(sm, gameId)
      expect(r1.state.players['mk_d0']!.alive).toBe(false)
      expect(
        r1.events.some((e) => e._tag === 'kill' && e.killerId === 'mk_r0' && e.victimId === 'mk_d0'),
      ).toBe(true)
      const delta1 = r1.state.players['mk_r0']!.gold - before1.players['mk_r0']!.gold
      expect(delta1 - PASSIVE_GOLD_PER_TICK).toBeGreaterThanOrEqual(minBounty)
      expect(delta1 - PASSIVE_GOLD_PER_TICK).toBeLessThanOrEqual(maxBounty)

      // Kill #2, next tick — the double kill
      await arrange(sm, gameId, (s) => setPlayer(s, 'mk_d1', { hp: 1 }))
      const before2 = await Effect.runPromise(sm.getState(gameId))
      submitAction(gameId, 'mk_r0', { type: 'attack', target: { kind: 'hero', name: 'mk_d1' } })
      const r2 = await runTick(sm, gameId)
      expect(r2.state.players['mk_d1']!.alive).toBe(false)
      expect(
        r2.events.some((e) => e._tag === 'kill' && e.killerId === 'mk_r0' && e.victimId === 'mk_d1'),
      ).toBe(true)
      const delta2 = r2.state.players['mk_r0']!.gold - before2.players['mk_r0']!.gold
      expect(delta2 - PASSIVE_GOLD_PER_TICK).toBeGreaterThanOrEqual(minBounty)
      expect(delta2 - PASSIVE_GOLD_PER_TICK).toBeLessThanOrEqual(maxBounty)

      // Multi-kill bookkeeping: two kills, a 2-streak, one death per victim
      const killer = r2.state.players['mk_r0']!
      expect(killer.kills).toBe(2)
      expect(killer.killStreak).toBe(2)
      expect(r2.state.players['mk_d0']!.deaths).toBe(1)
      expect(r2.state.players['mk_d1']!.deaths).toBe(1)
      expect(r2.state.teams.radiant.kills).toBe(2)
    })
  })

  describe('Item System Integration', () => {
    it('buys and sells items round-trip with 50% sell refund', async () => {
      const sm = createInMemoryStateManager()
      const setup = [
        { id: 'p1', name: 'p1', team: 'radiant' as const, heroId: 'echo' },
        { id: 'p2', name: 'p2', team: 'dire' as const, heroId: 'daemon' },
      ]
      await Effect.runPromise(sm.createGame('g1', setup))

      const s0 = await Effect.runPromise(sm.getState('g1'))
      const startGold = s0.players.p1!.gold
      const afterBuy = await Effect.runPromise(buyItem(s0, 'p1', 'iron_branch'))
      const branchCost = startGold - afterBuy.players.p1!.gold
      expect(branchCost).toBeGreaterThan(0)
      expect(afterBuy.players.p1!.items.filter((i) => i === 'iron_branch')).toHaveLength(1)

      // Sell it back — refund is 50% of cost (floored)
      const slot = afterBuy.players.p1!.items.indexOf('iron_branch')
      const afterSell = await Effect.runPromise(sellItem(afterBuy, 'p1', slot))
      const refunded = afterSell.players.p1!.gold - afterBuy.players.p1!.gold
      expect(refunded).toBe(Math.floor(branchCost * 0.5))
      expect(afterSell.players.p1!.items[slot]).toBeNull()
    })

    it('preserves HP percentage when selling HP items', async () => {
      const gameId = uid('hp')
      const sm = await startGame(gameId, makePlayers('ihp', 1))
      const initial = await Effect.runPromise(sm.getState(gameId))
      const baseMaxHp = initial.players['ihp_r0']!.maxHp
      const itemHp = getItem('vanguard')!.stats.hp!
      expect(itemHp).toBeGreaterThan(0)

      // Buy an HP item through the engine — maxHp grows by the item bonus
      await arrange(sm, gameId, (s) => setPlayer(s, 'ihp_r0', { gold: 5_000 }))
      submitAction(gameId, 'ihp_r0', { type: 'buy', item: 'vanguard' })
      let result = await runTick(sm, gameId)
      const bought = result.state.players['ihp_r0']!
      expect(bought.items).toContain('vanguard')
      expect(bought.maxHp).toBe(baseMaxHp + itemHp)

      // Wound to ~50% (inCombat blocks fountain regen so HP stays put)
      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'ihp_r0', {
          hp: Math.floor((baseMaxHp + itemHp) / 2),
          buffs: [inCombatBuff()],
        }),
      )
      const preSell = await Effect.runPromise(sm.getState(gameId))
      const hpPercent = preSell.players['ihp_r0']!.hp / preSell.players['ihp_r0']!.maxHp

      submitAction(gameId, 'ihp_r0', { type: 'sell', item: 'vanguard' })
      result = await runTick(sm, gameId)
      const sold = result.state.players['ihp_r0']!

      expect(sold.items).not.toContain('vanguard')
      expect(sold.maxHp).toBe(baseMaxHp)
      // The percentage — not the flat HP — carried over the max-HP drop
      expect(sold.hp).toBe(Math.floor(baseMaxHp * hpPercent))
    })

    it('preserves MP percentage when buying MP items', async () => {
      const gameId = uid('mp')
      const sm = await startGame(gameId, makePlayers('imp', 1))
      const initial = await Effect.runPromise(sm.getState(gameId))
      const baseMaxMp = initial.players['imp_r0']!.maxMp
      expect(baseMaxMp).toBeGreaterThan(0)
      const itemMp = getItem('aether_lens')!.stats.mp!
      expect(itemMp).toBeGreaterThan(0)

      // Drain to ~50% MP first (inCombat blocks fountain mana regen)
      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'imp_r0', {
          gold: 5_000,
          mp: Math.floor(baseMaxMp / 2),
          buffs: [inCombatBuff()],
        }),
      )
      const pre = await Effect.runPromise(sm.getState(gameId))
      const mpPercent = pre.players['imp_r0']!.mp / pre.players['imp_r0']!.maxMp

      submitAction(gameId, 'imp_r0', { type: 'buy', item: 'aether_lens' })
      const result = await runTick(sm, gameId)
      const bought = result.state.players['imp_r0']!

      expect(bought.items).toContain('aether_lens')
      expect(bought.maxMp).toBe(baseMaxMp + itemMp)
      // The percentage — not the flat MP — carried over the max-MP increase
      expect(bought.mp).toBe(Math.floor((baseMaxMp + itemMp) * mpPercent))
    })

    it('rejects 7th item purchase when inventory is full', async () => {
      const gameId = uid('inv')
      const sm = await startGame(gameId, makePlayers('inv', 1))

      const sixItems = [
        'iron_branch',
        'ring_of_health',
        'aether_lens',
        'healing_salve',
        'mana_vial',
        'observer_ward',
      ]
      for (const id of sixItems) {
        expect(getItem(id), `fixture item ${id} must exist in the registry`).toBeTruthy()
      }

      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'inv_r0', { gold: 50_000, items: [...sixItems] }),
      )
      const state = await Effect.runPromise(sm.getState(gameId))

      // 7th purchase (an item NOT already owned, so the stack-cap check
      // can't reject it first) must fail with InventoryFullError
      const error = await Effect.runPromise(Effect.flip(buyItem(state, 'inv_r0', 'vanguard')))
      expect(error._tag).toBe('InventoryFullError')

      // and the state is untouched — no gold deducted, no item granted
      const unchanged = await Effect.runPromise(sm.getState(gameId))
      expect(unchanged.players['inv_r0']!.gold).toBe(50_000)
      expect(unchanged.players['inv_r0']!.items.filter(Boolean)).toHaveLength(6)
    })
  })

  describe('Vision System Integration', () => {
    it('only shows visible zones to players — enemies outside vision are fogged', async () => {
      const gameId = uid('vis')
      const sm = await startGame(gameId, makePlayers('vis', 1))
      // An enemy creep deep in dire territory must not leak through the fog
      await arrange(sm, gameId, (s) => ({
        ...s,
        creeps: [
          ...s.creeps,
          { id: 'creep_fog_probe', team: 'dire' as const, zone: 'dire-base', hp: 550, type: 'melee' as const },
        ],
      }))

      const state = await Effect.runPromise(sm.getState(gameId))
      const view = filterStateForPlayer(state, 'vis_r0')

      // Own surroundings are visible; the enemy side is not
      expect(view.visibleZones).toContain('radiant-fountain')
      expect(view.visibleZones).toContain('radiant-base')
      expect(view.visibleZones).not.toContain('dire-fountain')
      expect(view.visibleZones).not.toContain('dire-base')

      // The enemy hero appears only as a FoggedPlayer — no zone/gold leak
      const enemy = view.players['vis_d0']!
      expect(enemy).toMatchObject({ id: 'vis_d0', fogged: true })
      expect('zone' in enemy).toBe(false)
      expect('gold' in enemy).toBe(false)

      // Creeps in fogged zones are stripped from the payload
      expect(view.creeps.some((c) => c.id === 'creep_fog_probe')).toBe(false)
      expect(view.zones['dire-base']!.creeps).toEqual([])

      // Once the enemy steps into radiant vision they are fully revealed
      const revealed = filterStateForPlayer(
        setPlayer(state, 'vis_d0', { zone: 'radiant-base' }),
        'vis_r0',
      )
      const enemyVisible = revealed.players['vis_d0']!
      expect('fogged' in enemyVisible).toBe(false)
      expect((enemyVisible as PlayerState).zone).toBe('radiant-base')
    })

    it('updates vision when wards are placed', async () => {
      const gameId = uid('ward')
      const sm = await startGame(gameId, makePlayers('ward', 1))

      const before = await Effect.runPromise(sm.getState(gameId))
      const viewBefore = filterStateForPlayer(before, 'ward_r0')
      expect(viewBefore.visibleZones).not.toContain('mid-t2-dire')

      // Walk the warder deep into dire territory carrying an observer ward
      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'ward_r0', {
          zone: 'mid-t1-dire',
          items: ['observer_ward', null, null, null, null, null],
        }),
      )

      submitAction(gameId, 'ward_r0', { type: 'ward', zone: 'mid-t2-dire' })
      const result = await runTick(sm, gameId)

      expect(
        result.events.some((e) => e._tag === 'ward_placed' && e.zone === 'mid-t2-dire'),
      ).toBe(true)
      const wards = result.state.zones['mid-t2-dire']!.wards
      expect(wards).toHaveLength(1)
      expect(wards[0]).toMatchObject({ team: 'radiant', type: 'observer' })
      // The ward was consumed from the inventory
      expect(result.state.players['ward_r0']!.items.filter(Boolean)).toHaveLength(0)

      // Send the warder home — the warded zone stays visible to the team
      // purely through the ward (no hero, tower, or ally anywhere near it)
      const homeState = setPlayer(result.state, 'ward_r0', { zone: 'radiant-fountain' })
      const viewAfter = filterStateForPlayer(homeState, 'ward_r0')
      expect(viewAfter.visibleZones).toContain('mid-t2-dire')
    })
  })
})
