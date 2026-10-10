import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, ENEMY } from './harness'
import { getBotPlayerIds, isGameBot, cleanupGame, getBotLane } from '~~/server/game/ai/BotManager'
import { rehydrateRegistries } from '~~/server/workflows/gameTickCore'
import { withPresenceSample, PRESENCE_CONFIRM_CYCLES } from '~~/server/services/LeaverSystem'
import type { LiveGameRoster } from '~~/server/db/schema'
import type { Run } from './harness'

/**
 * Engine-truth coverage for the AFK → bot takeover, driven through the real
 * processCycle (no browser/server/DB). The harness never submits actions unless
 * told to, so a seeded human is idle by default.
 *
 * Connection is DATA: the production tick stamps an Ably-presence sample into
 * `state.presenceOffline` before the AFK-check cycle runs. These tests stamp it
 * by hand (`markOffline`). No sample ⇒ connected ⇒ only the long (60-cycle),
 * teammate-gated rule can fire. "Disconnected" takes TWO samples — the primary
 * check (cycle 60) and its confirm (cycle 65) — so a page reload that straddles
 * one sample never hands a connected player to a bot.
 */

/** Stamp "Ably says these players are gone" for the AFK sample on `cycle`. */
function markOffline(run: Run, cycle: number, ...ids: string[]) {
  return run.patch((s) => withPresenceSample(s, cycle, ids))
}

/** Gone at the primary check on `cycle` AND at its confirm sample. */
async function markGone(run: Run, cycle: number, ...ids: string[]) {
  await markOffline(run, cycle, ...ids)
  return markOffline(run, cycle + PRESENCE_CONFIRM_CYCLES, ...ids)
}

const CONFIRM = 60 + PRESENCE_CONFIRM_CYCLES

const MATE = 'mate'

/** Two chaff humans (HUMAN + MATE) vs one audit human. */
function seedWithTeammate() {
  return seedGame('laning', {
    players: [
      { id: HUMAN, name: HUMAN, team: 'chaff', heroId: 'echo' },
      { id: MATE, name: MATE, team: 'chaff', heroId: 'cron' },
      { id: ENEMY, name: ENEMY, team: 'audit', heroId: 'daemon' },
    ],
  })
}

/** Keep MATE "active" as of the current cycle (they issued an order). */
function mateActs(run: Run) {
  return run.patch((s) => ({
    ...s,
    players: { ...s.players, [MATE]: { ...s.players[MATE]!, lastActionCycle: s.cycle } },
  }))
}

describe('AFK takeover', () => {
  describe('a DISCONNECTED human (Ably presence says gone)', () => {
    it('is not converted before the confirm sample of the first AFK check', async () => {
      const run = await seedGame('laning')
      await markGone(run, 60, HUMAN)
      await run.tick(CONFIRM - 1)

      expect(isGameBot(run.gameId, HUMAN)).toBe(false)
      expect((await run.player(HUMAN)).aiControlled ?? false).toBe(false)
      expect(run.allEvents.some((e) => e._tag === 'afk_takeover')).toBe(false)
    })

    it('is replaced by a bot at the confirm sample — even with no human teammate', async () => {
      const run = await seedGame('laning')
      await markGone(run, 60, HUMAN)
      await run.tick(CONFIRM)

      // Now in the bot roster, so the GameLoop bot driver controls the slot.
      expect(getBotPlayerIds(run.gameId)).toContain(HUMAN)
      expect(isGameBot(run.gameId, HUMAN)).toBe(true)
      // Flagged for the UI...
      expect((await run.player(HUMAN)).aiControlled).toBe(true)
      // ...and announced exactly once for everyone to see.
      const takeovers = run.allEvents.filter(
        (e) => e._tag === 'afk_takeover' && e.playerId === HUMAN,
      )
      expect(takeovers).toHaveLength(1)
      // The enemy was not in the sample ⇒ connected ⇒ solo on audit ⇒ kept.
      expect((await run.player(ENEMY)).aiControlled ?? false).toBe(false)
    })

    it('a sample stamped for another cycle is ignored (stale ⇒ connected)', async () => {
      const run = await seedGame('laning')
      await markOffline(run, 59, HUMAN)
      await markOffline(run, CONFIRM, HUMAN)
      await run.tick(CONFIRM)
      expect((await run.player(HUMAN)).aiControlled ?? false).toBe(false)
    })

    it('ONE offline sample is not enough — a reload during the check keeps the player', async () => {
      // Gone at the primary check only (page reload: presence leave is
      // immediate on a clean close), back by the confirm sample.
      const reload = await seedGame('laning')
      await markOffline(reload, 60, HUMAN)
      await reload.tick(CONFIRM + 5)
      expect((await reload.player(HUMAN)).aiControlled ?? false).toBe(false)
      expect(reload.allEvents.some((e) => e._tag === 'afk_takeover')).toBe(false)

      // Present at the primary check, gone at the confirm: never asked twice.
      const late = await seedGame('laning')
      await markOffline(late, CONFIRM, HUMAN)
      await late.tick(CONFIRM + 5)
      expect((await late.player(HUMAN)).aiControlled ?? false).toBe(false)
    })

    it('an order between the two samples keeps the player (they are back)', async () => {
      const run = await seedGame('laning')
      await markGone(run, 60, HUMAN)
      await run.tick(62)
      run.submit({ type: 'move', zone: 'coldstore-t1-chaff' })
      await run.tick(CONFIRM - 62)
      expect((await run.player(HUMAN)).aiControlled ?? false).toBe(false)
    })

    it('does not re-announce the takeover on later AFK checks', async () => {
      const run = await seedGame('laning')
      await markGone(run, 60, HUMAN)
      await markGone(run, 120, HUMAN)
      await run.tick(130)

      const takeovers = run.allEvents.filter(
        (e) => e._tag === 'afk_takeover' && e.playerId === HUMAN,
      )
      expect(takeovers).toHaveLength(1)
    })

    it('lets the bot drive the converted hero from the next cycle', async () => {
      const run = await seedGame('laning')
      await markGone(run, 60, HUMAN)
      await run.tick(CONFIRM)
      const atConversion = (await run.player(HUMAN)).lastActionCycle ?? 0

      await run.tick(10)
      // The bot driver submits actions for the slot, advancing lastActionCycle
      // past the conversion tick — proof a bot, not the human, is now playing.
      expect((await run.player(HUMAN)).lastActionCycle ?? 0).toBeGreaterThan(atConversion)
    })
  })

  describe('a CONNECTED human (no offline sample)', () => {
    it('is never converted when alone on the team (practice vs bots)', async () => {
      const run = await seedGame('laning')
      await run.tick(240) // four AFK checks, fully silent

      expect((await run.player(HUMAN)).aiControlled ?? false).toBe(false)
      expect(run.allEvents.some((e) => e._tag === 'afk_takeover')).toBe(false)
    })

    it('with a human teammate, is converted only after 60 silent cycles', async () => {
      const run = await seedWithTeammate()
      // HUMAN gives one order on cycle 1 (e.g. a long auto-walk), then watches.
      run.submit({ type: 'move', zone: 'seawall-t1-chaff' })
      await run.tick(2)
      // A multi-hop auto-walk is under way; its continuations are synthesized
      // and do NOT count as activity — only the order itself did.
      expect((await run.player(HUMAN)).moveTarget).toBe('seawall-t1-chaff')
      expect((await run.player(HUMAN)).lastActionCycle).toBe(1)
      await run.tick(57)
      await mateActs(run)
      await run.tick(1) // cycle 60 check: HUMAN silent 59 cycles ⇒ kept
      expect((await run.state()).cycle).toBe(60)
      expect((await run.player(HUMAN)).lastActionCycle).toBe(1)
      expect((await run.player(HUMAN)).aiControlled ?? false).toBe(false)

      await run.tick(59)
      await mateActs(run)
      await run.tick(1) // cycle 120 check: silent 119 ⇒ converted
      expect((await run.state()).cycle).toBe(120)
      expect((await run.player(HUMAN)).aiControlled).toBe(true)
      expect((await run.player(MATE)).aiControlled ?? false).toBe(false)
    })
  })

  // PRODUCTION runs each cycle through gameTickCore.runOneTick, which calls
  // rehydrateRegistries on a possibly fresh instance BEFORE processCycle. The
  // tests above never do — so they passed while, in prod, the converted human
  // fell out of the bot set on the very next tick and idled forever.
  describe('across per-cycle registry rehydration (the production path)', () => {
    const roster: LiveGameRoster = {
      players: [
        { playerId: HUMAN, team: 'chaff', heroId: 'echo', mmr: 1000 },
        { playerId: 'enemy', team: 'audit', heroId: 'daemon', mmr: 1000 },
      ],
    }

    /** One production cycle: rehydrate from the persisted state, then tick. */
    async function prodTick(run: Run, n: number) {
      for (let i = 0; i < n; i++) {
        rehydrateRegistries(run.gameId, roster, await run.state())
        await run.tick(1)
      }
    }

    it('keeps the converted human bot-driven after the registry is rebuilt', async () => {
      const run = await seedGame('laning')
      await markGone(run, 60, HUMAN)
      await prodTick(run, CONFIRM) // conversion happens on the confirm cycle
      expect((await run.player(HUMAN)).aiControlled).toBe(true)

      // A cold instance picks the game up: all in-memory bot state is gone.
      cleanupGame(run.gameId)
      expect(isGameBot(run.gameId, HUMAN)).toBe(false)

      const atConversion = (await run.player(HUMAN)).lastActionCycle ?? 0
      await prodTick(run, 10)

      expect(isGameBot(run.gameId, HUMAN)).toBe(true)
      expect(getBotPlayerIds(run.gameId)).toContain(HUMAN)
      // The bot driver kept issuing the slot's actions on later cycles.
      expect((await run.player(HUMAN)).lastActionCycle ?? 0).toBeGreaterThan(atConversion)
      // ...and the converted slot keeps a real lane, not a blind default.
      expect(['seawall', 'coldstore', 'shallows']).toContain(getBotLane(run.gameId, HUMAN))
    })

    it('does not re-announce the takeover after a rebuild', async () => {
      const run = await seedGame('laning')
      await markGone(run, 60, HUMAN)
      await prodTick(run, 130)
      const takeovers = run.allEvents.filter(
        (e) => e._tag === 'afk_takeover' && e.playerId === HUMAN,
      )
      expect(takeovers).toHaveLength(1)
    })
  })
})
