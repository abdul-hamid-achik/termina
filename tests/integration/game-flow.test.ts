import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import type { GameState, PlayerState } from '~~/shared/types/game'
import {
  createInMemoryStateManager,
  type PlayerSetup,
  type StateManagerApi,
} from '~~/server/game/engine/StateManager'
import { processCycle, submitAction } from '~~/server/game/engine/GameLoop'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import { buyItem, sellItem } from '~~/server/game/items/shop'
import { getItem } from '~~/shared/constants/items'
import type { GameEngineEvent } from '~~/server/game/protocol/events'
import {
  KILL_BOUNTY_BASE,
  ASSIST_SCRIP,
  PASSIVE_SCRIP_PER_CYCLE,
  SURRENDER_MIN_CYCLE,
  COMEBACK_BONUS_MAX,
  COMEBACK_PENALTY_MAX,
} from '~~/shared/constants/balance'
import { HERO_IDS } from '~~/shared/constants/heroes'

/**
 * Integration tests for the game lifecycle, driven through the REAL engine
 * (`createInMemoryStateManager` + `submitAction` + `processCycle`) — the same
 * pipeline `scripts/simulate-game.ts` uses for full bot matches.
 *
 * NOTE: These tests deliberately avoid importing `server/plugins/game-server.ts`
 * because that module's default export is a `defineNitroPlugin(...)` call,
 * which is only resolvable inside the Nitro runtime — vitest can't load it.
 * Cross-cutting flows that need the plugin (matchmaking → game_ready → game
 * start) live in tests/e2e as Cairntrace BDD flows instead. This file covers
 * what can be tested with the bare engine + state manager.
 *
 * Flows that do NOT exist at this layer (and where they ARE tested):
 * - Action rate limiting: enforced per-request in server/api/game/action.post.ts
 *   (the workflow-driven ingress — the DO-era ws.ts route it replaced is gone)
 *   via server/utils/RateLimiter.ts before commands ever reach the engine (the
 *   engine itself dedupes to one action per player per cycle). Covered by
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
  const result = await Effect.runPromise(processCycle(gameId, state))
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

/** Fountain healing/regen is skipped while inCombat — used to freeze INTEG/BW. */
function inCombatBuff() {
  return { id: 'inCombat', stacks: 1, cyclesRemaining: 3, source: 'system' }
}

function makePlayers(prefix: string, perTeam: number): PlayerSetup[] {
  const chaff = Array.from({ length: perTeam }, (_, i) => ({
    id: `${prefix}_r${i}`,
    name: `${prefix}_r${i}`,
    team: 'chaff' as const,
    heroId: HERO_IDS[i]!,
  }))
  const audit = Array.from({ length: perTeam }, (_, i) => ({
    id: `${prefix}_d${i}`,
    name: `${prefix}_d${i}`,
    team: 'audit' as const,
    heroId: HERO_IDS[perTeam + i]!,
  }))
  return [...chaff, ...audit]
}

describe('Game Flow Integration', () => {
  describe('Full Game Lifecycle', () => {
    it('completes a full game — destroying the enemy Terminal ends it', async () => {
      const gameId = uid('full')
      const sm = await startGame(gameId, makePlayers('fg', 1))

      // Arrange the end-game: a audit T3 ice is already down (which makes
      // the audit Terminal vulnerable), the chaff hero has sieged into the
      // enemy base, and the Terminal is low so the test stays fast.
      await arrange(sm, gameId, (s) => {
        const sieged = setPlayer(s, 'fg_r0', { zone: 'landing-terminal' })
        return {
          ...sieged,
          ice: sieged.ice.map((t) =>
            t.zone === 'coldstore-t3-audit' ? { ...t, alive: false, integ: 0 } : t,
          ),
          terminals: {
            ...sieged.terminals,
            audit: { ...sieged.terminals.audit, integ: 400 },
          },
        }
      })

      const allEvents: GameEngineEvent[] = []
      let final: GameState | null = null
      for (let i = 0; i < 60; i++) {
        submitAction(gameId, 'fg_r0', { type: 'attack', target: { kind: 'terminal' } })
        const result = await runTick(sm, gameId)
        allEvents.push(...result.events)
        final = result.state
        if (i === 0) {
          // The engine recomputed vulnerability from the dead T3 ice
          expect(result.state.terminals.audit.vulnerable).toBe(true)
        }
        if (result.state.phase === 'ended') break
      }

      expect(final).not.toBeNull()
      const endState = final!
      expect(endState.phase).toBe('ended')
      expect(endState.winner).toBe('chaff')
      expect(endState.terminals.audit.alive).toBe(false)
      expect(endState.terminals.audit.integ).toBe(0)
      expect(endState.terminals.chaff.alive).toBe(true)

      // Hero damage was routed to the Terminal and its destruction was
      // announced via the dedicated terminal_destroyed event (not a reused
      // ice_kill, which would render a misleading "ice in <base>" line).
      expect(allEvents.some((e) => e._tag === 'damage' && e.targetId === 'terminal_audit')).toBe(
        true,
      )
      expect(
        allEvents.some(
          (e) => e._tag === 'terminal_destroyed' && e.team === 'audit' && e.killerTeam === 'chaff',
        ),
      ).toBe(true)
    })

    it('handles surrender vote — passes at the 60% threshold, not below', async () => {
      const gameId = uid('ff')
      const sm = await startGame(gameId, makePlayers('ff', 5))
      // Surrender opens at SURRENDER_MIN_CYCLE; jump straight past the gate
      await arrange(sm, gameId, (s) => ({ ...s, cycle: SURRENDER_MIN_CYCLE }))

      // 2 of 5 alive players = 40% — below the 60% threshold (needs 3)
      submitAction(gameId, 'ff_r0', { type: 'surrender', vote: 'yes' })
      submitAction(gameId, 'ff_r1', { type: 'surrender', vote: 'yes' })
      let result = await runTick(sm, gameId)

      expect(result.state.phase).toBe('playing')
      expect(result.state.surrenderVotes.chaff.size).toBe(2)
      const voteEvents = result.events.filter((e) => e._tag === 'surrender_vote')
      expect(voteEvents).toHaveLength(2)
      expect(voteEvents.at(-1)).toMatchObject({ votesFor: 2, votesNeeded: 3 })

      // Third vote tips it over the threshold — chaff forfeits, audit wins
      submitAction(gameId, 'ff_r2', { type: 'surrender', vote: 'yes' })
      result = await runTick(sm, gameId)

      expect(result.state.phase).toBe('ended')
      expect(result.state.winner).toBe('audit')
      expect(
        result.events.some(
          (e) => e._tag === 'surrendered' && e.team === 'chaff' && e.winner === 'audit',
        ),
      ).toBe(true)
    })
  })

  describe('Gold Distribution Integration', () => {
    it('distributes scrip correctly in a team fight (killer bounty + assist pot, no double-dip)', async () => {
      const gameId = uid('tf')
      const sm = await startGame(gameId, makePlayers('tf', 2))
      // killer + assister + victim share a zone; the 2nd audit player idles in
      // the fountain keeping team net-worths balanced (comeback multiplier ≈ 1)
      await arrange(sm, gameId, (s) => {
        let next = setPlayer(s, 'tf_r0', { zone: 'coldstore-cross' })
        next = setPlayer(next, 'tf_r1', { zone: 'coldstore-cross' })
        next = setPlayer(next, 'tf_d0', { zone: 'coldstore-cross' })
        return next
      })

      // Tick 1: the assister softens the victim — this damage registers in
      // the engine's assist window.
      submitAction(gameId, 'tf_r1', { type: 'attack', target: { kind: 'hero', name: 'tf_d0' } })
      const r1 = await runTick(sm, gameId)
      const softened = r1.state.players['tf_d0']!
      expect(softened.integ).toBeLessThan(softened.maxInteg)
      expect(softened.alive).toBe(true)

      // Arrange a lethal blow, snapshot scrip, then the killer finishes
      await arrange(sm, gameId, (s) => setPlayer(s, 'tf_d0', { integ: 1 }))
      const before = await Effect.runPromise(sm.getState(gameId))

      submitAction(gameId, 'tf_r0', { type: 'attack', target: { kind: 'hero', name: 'tf_d0' } })
      const r2 = await runTick(sm, gameId)
      const after = r2.state

      // Scoreboard counters
      expect(after.players['tf_d0']!.alive).toBe(false)
      expect(after.players['tf_d0']!.deaths).toBe(1)
      expect(after.players['tf_r0']!.kills).toBe(1)
      expect(after.players['tf_r1']!.assists).toBe(1)
      expect(after.teams.chaff.kills).toBe(1)

      // Kill event credits exactly one killer and one assister
      const killEvent = r2.events.find((e) => e._tag === 'kill')
      expect(killEvent).toMatchObject({
        killerId: 'tf_r0',
        victimId: 'tf_d0',
        assisters: ['tf_r1'],
      })

      const killerDelta = after.players['tf_r0']!.scrip - before.players['tf_r0']!.scrip
      const assistDelta = after.players['tf_r1']!.scrip - before.players['tf_r1']!.scrip
      const victimDelta = after.players['tf_d0']!.scrip - before.players['tf_d0']!.scrip

      // Killer: base bounty (victim streak 0, balanced net-worths → ×1)
      // plus this cycle's passive scrip. NOT the assist pot too.
      expect(killerDelta).toBe(KILL_BOUNTY_BASE + PASSIVE_SCRIP_PER_CYCLE)
      // Sole assister collects the full assist pot plus passive scrip.
      expect(assistDelta).toBe(ASSIST_SCRIP + PASSIVE_SCRIP_PER_CYCLE)
      // The dead victim earns nothing this cycle.
      expect(victimDelta).toBe(0)
    })

    it('handles multi-kill scrip distribution — consecutive kills build streak, each pays a bounty', async () => {
      const gameId = uid('mk')
      const sm = await startGame(gameId, makePlayers('mk', 2))
      await arrange(sm, gameId, (s) => {
        let next = setPlayer(s, 'mk_r0', { zone: 'coldstore-cross' })
        next = setPlayer(next, 'mk_d0', { zone: 'coldstore-cross', integ: 1 })
        next = setPlayer(next, 'mk_d1', { zone: 'coldstore-cross' })
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
        r1.events.some(
          (e) => e._tag === 'kill' && e.killerId === 'mk_r0' && e.victimId === 'mk_d0',
        ),
      ).toBe(true)
      const delta1 = r1.state.players['mk_r0']!.scrip - before1.players['mk_r0']!.scrip
      expect(delta1 - PASSIVE_SCRIP_PER_CYCLE).toBeGreaterThanOrEqual(minBounty)
      expect(delta1 - PASSIVE_SCRIP_PER_CYCLE).toBeLessThanOrEqual(maxBounty)

      // Kill #2, next cycle — the double kill
      await arrange(sm, gameId, (s) => setPlayer(s, 'mk_d1', { integ: 1 }))
      const before2 = await Effect.runPromise(sm.getState(gameId))
      submitAction(gameId, 'mk_r0', { type: 'attack', target: { kind: 'hero', name: 'mk_d1' } })
      const r2 = await runTick(sm, gameId)
      expect(r2.state.players['mk_d1']!.alive).toBe(false)
      expect(
        r2.events.some(
          (e) => e._tag === 'kill' && e.killerId === 'mk_r0' && e.victimId === 'mk_d1',
        ),
      ).toBe(true)
      const delta2 = r2.state.players['mk_r0']!.scrip - before2.players['mk_r0']!.scrip
      expect(delta2 - PASSIVE_SCRIP_PER_CYCLE).toBeGreaterThanOrEqual(minBounty)
      expect(delta2 - PASSIVE_SCRIP_PER_CYCLE).toBeLessThanOrEqual(maxBounty)

      // Multi-kill bookkeeping: two kills, a 2-streak, one death per victim
      const killer = r2.state.players['mk_r0']!
      expect(killer.kills).toBe(2)
      expect(killer.killStreak).toBe(2)
      expect(r2.state.players['mk_d0']!.deaths).toBe(1)
      expect(r2.state.players['mk_d1']!.deaths).toBe(1)
      expect(r2.state.teams.chaff.kills).toBe(2)
    })
  })

  describe('Item System Integration', () => {
    it('buys and sells items round-trip with 50% sell refund', async () => {
      const sm = createInMemoryStateManager()
      const setup = [
        { id: 'p1', name: 'p1', team: 'chaff' as const, heroId: 'echo' },
        { id: 'p2', name: 'p2', team: 'audit' as const, heroId: 'daemon' },
      ]
      await Effect.runPromise(sm.createGame('g1', setup))

      const s0 = await Effect.runPromise(sm.getState('g1'))
      const startGold = s0.players.p1!.scrip
      const afterBuy = await Effect.runPromise(buyItem(s0, 'p1', 'scrap_lot'))
      const branchCost = startGold - afterBuy.players.p1!.scrip
      expect(branchCost).toBeGreaterThan(0)
      expect(afterBuy.players.p1!.items.filter((i) => i === 'scrap_lot')).toHaveLength(1)

      // Sell it back — refund is 50% of cost (floored)
      const slot = afterBuy.players.p1!.items.indexOf('scrap_lot')
      const afterSell = await Effect.runPromise(sellItem(afterBuy, 'p1', slot))
      const refunded = afterSell.players.p1!.scrip - afterBuy.players.p1!.scrip
      expect(refunded).toBe(Math.floor(branchCost * 0.5))
      expect(afterSell.players.p1!.items[slot]).toBeNull()
    })

    it('preserves INTEG percentage when selling INTEG items', async () => {
      const gameId = uid('integ')
      const sm = await startGame(gameId, makePlayers('ihp', 1))
      const initial = await Effect.runPromise(sm.getState(gameId))
      const baseMaxHp = initial.players['ihp_r0']!.maxInteg
      const itemHp = getItem('bulwark_plate')!.stats.integ!
      expect(itemHp).toBeGreaterThan(0)

      // Buy an INTEG item through the engine — maxInteg grows by the item bonus
      await arrange(sm, gameId, (s) => setPlayer(s, 'ihp_r0', { scrip: 5_000 }))
      submitAction(gameId, 'ihp_r0', { type: 'buy', item: 'bulwark_plate' })
      let result = await runTick(sm, gameId)
      const bought = result.state.players['ihp_r0']!
      expect(bought.items).toContain('bulwark_plate')
      expect(bought.maxInteg).toBe(baseMaxHp + itemHp)

      // Wound to ~50% (inCombat blocks fountain regen so INTEG stays put)
      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'ihp_r0', {
          integ: Math.floor((baseMaxHp + itemHp) / 2),
          buffs: [inCombatBuff()],
        }),
      )
      const preSell = await Effect.runPromise(sm.getState(gameId))
      const hpPercent = preSell.players['ihp_r0']!.integ / preSell.players['ihp_r0']!.maxInteg

      submitAction(gameId, 'ihp_r0', { type: 'sell', item: 'bulwark_plate' })
      result = await runTick(sm, gameId)
      const sold = result.state.players['ihp_r0']!

      expect(sold.items).not.toContain('bulwark_plate')
      expect(sold.maxInteg).toBe(baseMaxHp)
      // The percentage — not the flat INTEG — carried over the max-HP drop
      expect(sold.integ).toBe(Math.floor(baseMaxHp * hpPercent))
    })

    it('preserves BW percentage when buying BW items', async () => {
      const gameId = uid('bw')
      const sm = await startGame(gameId, makePlayers('imp', 1))
      const initial = await Effect.runPromise(sm.getState(gameId))
      const baseMaxMp = initial.players['imp_r0']!.maxBw
      expect(baseMaxMp).toBeGreaterThan(0)
      const itemMp = getItem('clock_lens')!.stats.bw!
      expect(itemMp).toBeGreaterThan(0)

      // Drain to ~50% BW first (inCombat blocks fountain BW regen)
      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'imp_r0', {
          scrip: 5_000,
          bw: Math.floor(baseMaxMp / 2),
          buffs: [inCombatBuff()],
        }),
      )
      const pre = await Effect.runPromise(sm.getState(gameId))
      const mpPercent = pre.players['imp_r0']!.bw / pre.players['imp_r0']!.maxBw

      submitAction(gameId, 'imp_r0', { type: 'buy', item: 'clock_lens' })
      const result = await runTick(sm, gameId)
      const bought = result.state.players['imp_r0']!

      expect(bought.items).toContain('clock_lens')
      expect(bought.maxBw).toBe(baseMaxMp + itemMp)
      // The percentage — not the flat BW — carried over the max-MP increase
      expect(bought.bw).toBe(Math.floor((baseMaxMp + itemMp) * mpPercent))
    })

    it('rejects 7th item purchase when inventory is full', async () => {
      const gameId = uid('inv')
      const sm = await startGame(gameId, makePlayers('inv', 1))

      const sixItems = [
        'scrap_lot',
        'clot_ring',
        'clock_lens',
        'trauma_patch',
        'charge_tab',
        'camtap',
      ]
      for (const id of sixItems) {
        expect(getItem(id), `fixture item ${id} must exist in the registry`).toBeTruthy()
      }

      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'inv_r0', { scrip: 50_000, items: [...sixItems] }),
      )
      const state = await Effect.runPromise(sm.getState(gameId))

      // 7th purchase (an item NOT already owned, so the stack-cap check
      // can't reject it first) must fail with InventoryFullError
      const error = await Effect.runPromise(Effect.flip(buyItem(state, 'inv_r0', 'bulwark_plate')))
      expect(error._tag).toBe('InventoryFullError')

      // and the state is untouched — no scrip deducted, no item granted
      const unchanged = await Effect.runPromise(sm.getState(gameId))
      expect(unchanged.players['inv_r0']!.scrip).toBe(50_000)
      expect(unchanged.players['inv_r0']!.items.filter(Boolean)).toHaveLength(6)
    })
  })

  describe('Vision System Integration', () => {
    it('only shows visible zones to players — enemies outside vision are fogged', async () => {
      const gameId = uid('vis')
      const sm = await startGame(gameId, makePlayers('vis', 1))
      // An enemy wave deep in audit territory must not leak through the fog
      await arrange(sm, gameId, (s) => ({
        ...s,
        waves: [
          ...s.waves,
          {
            id: 'wave_fog_probe',
            team: 'audit' as const,
            zone: 'landing-terminal',
            integ: 550,
            type: 'line' as const,
          },
        ],
      }))

      const state = await Effect.runPromise(sm.getState(gameId))
      const view = filterStateForPlayer(state, 'vis_r0')

      // Own surroundings are visible; the enemy side is not
      expect(view.visibleZones).toContain('rookery-anchor')
      expect(view.visibleZones).toContain('rookery-terminal')
      expect(view.visibleZones).not.toContain('landing-anchor')
      expect(view.visibleZones).not.toContain('landing-terminal')

      // The enemy hero appears only as a FoggedPlayer — no zone/gold leak
      const enemy = view.players['vis_d0']!
      expect(enemy).toMatchObject({ id: 'vis_d0', fogged: true })
      expect('zone' in enemy).toBe(false)
      expect('scrip' in enemy).toBe(false)

      // Waves in fogged zones are stripped from the payload. This used to also
      // assert `view.zones['landing-terminal'].waves` was empty — a field deleted from
      // ZoneRuntimeState in 0e82d3c, so the assertion was reading `undefined`
      // off a live object and comparing it to []. The top-level wave list is
      // where waves actually live, and it is the real fog guarantee.
      expect(view.waves.some((c) => c.id === 'wave_fog_probe')).toBe(false)
      expect(view.zones['landing-terminal']).toBeDefined()

      // Once the enemy steps into chaff vision they are fully revealed
      const revealed = filterStateForPlayer(
        setPlayer(state, 'vis_d0', { zone: 'rookery-terminal' }),
        'vis_r0',
      )
      const enemyVisible = revealed.players['vis_d0']!
      expect('fogged' in enemyVisible).toBe(false)
      expect((enemyVisible as PlayerState).zone).toBe('rookery-terminal')
    })

    it('updates vision when wards are placed', async () => {
      const gameId = uid('tap')
      const sm = await startGame(gameId, makePlayers('tap', 1))

      const before = await Effect.runPromise(sm.getState(gameId))
      const viewBefore = filterStateForPlayer(before, 'tap_r0')
      expect(viewBefore.visibleZones).not.toContain('coldstore-t2-audit')

      // Walk the warder deep into audit territory carrying an observer ward
      await arrange(sm, gameId, (s) =>
        setPlayer(s, 'tap_r0', {
          zone: 'coldstore-t1-audit',
          items: ['camtap', null, null, null, null, null],
        }),
      )

      submitAction(gameId, 'tap_r0', { type: 'tap', zone: 'coldstore-t2-audit' })
      const result = await runTick(sm, gameId)

      expect(
        result.events.some((e) => e._tag === 'ward_placed' && e.zone === 'coldstore-t2-audit'),
      ).toBe(true)
      const wards = result.state.zones['coldstore-t2-audit']!.wards
      expect(wards).toHaveLength(1)
      expect(wards[0]).toMatchObject({ team: 'chaff', type: 'camtap' })
      // The ward was consumed from the inventory
      expect(result.state.players['tap_r0']!.items.filter(Boolean)).toHaveLength(0)

      // Send the warder home — the warded zone stays visible to the team
      // purely through the ward (no hero, ice, or ally anywhere near it)
      const homeState = setPlayer(result.state, 'tap_r0', { zone: 'rookery-anchor' })
      const viewAfter = filterStateForPlayer(homeState, 'tap_r0')
      expect(viewAfter.visibleZones).toContain('coldstore-t2-audit')
    })
  })
})
