import { describe, it, expect } from 'vitest'
import {
  evaluateCoach,
  newlyLearned,
  COACH_TIP_IDS,
  COACH_COOLDOWN_CYCLES,
  type CoachInput,
  type CoachLearned,
} from '~~/app/utils/coach'

/**
 * The coach's contract is mostly about when it stays QUIET. A teaching layer
 * that talks too much is one the player learns to skip — and skipping the coach
 * means skipping the feed, which is the game. So most of this file is about
 * silence: retired lessons, cooldowns, and the dead.
 */
function input(over: Partial<CoachInput> = {}): CoachInput {
  return {
    cycle: 100,
    alive: true,
    hpFraction: 1,
    scrip: 0,
    level: 3,
    lastHits: 99,
    items: ['edge_kit', 'camtap', null, null, null, null],
    inShopZone: false,
    onRoute: true,
    hopIndex: 1,
    hopTotal: 8,
    enemiesHere: 0,
    alliesHere: 1,
    strippableWaves: 0,
    attackableIce: false,
    castsMade: 99,
    routeVision: 8,
    routeTotal: 8,
    ...over,
  }
}

describe('the coach', () => {
  describe('silence is the default', () => {
    it('says nothing when the player is doing fine', () => {
      expect(evaluateCoach(input(), {}, {})).toBeNull()
    })

    it('says nothing to a dead player — they cannot act on it', () => {
      const dying = input({ alive: false, hpFraction: 0.1, enemiesHere: 3 })
      expect(evaluateCoach(dying, {}, {})).toBeNull()
    })

    it('never repeats a tip inside its cooldown', () => {
      const s = input({ hpFraction: 0.2, enemiesHere: 2, cycle: 100 })
      const first = evaluateCoach(s, {}, {})
      expect(first?.id).toBe('retreat')

      const history = { retreat: 100 }
      expect(evaluateCoach({ ...s, cycle: 105 }, {}, history)).toBeNull()
      expect(evaluateCoach({ ...s, cycle: 100 + COACH_COOLDOWN_CYCLES }, {}, history)?.id).toBe(
        'retreat',
      )
    })

    it('never speaks about a lesson the player has already been taught', () => {
      const s = input({ hpFraction: 0.2, enemiesHere: 2 })
      const learned: CoachLearned = { retreat: true }
      expect(evaluateCoach(s, learned, {})).toBeNull()
    })
  })

  describe('it fires on situations, not on steps', () => {
    it('warns about low INTEG only while enemies are actually present', () => {
      expect(evaluateCoach(input({ hpFraction: 0.2, enemiesHere: 0 }), {}, {})).toBeNull()
      expect(evaluateCoach(input({ hpFraction: 0.2, enemiesHere: 1 }), {}, {})?.id).toBe('retreat')
    })

    it('calls out overextension only when deep AND alone AND blind', () => {
      const deep = { hopIndex: 6, hopTotal: 8, alliesHere: 0, routeVision: 1 }
      expect(evaluateCoach(input(deep), {}, {})?.id).toBe('overextended')
      // With an ally it is a push, not an overextension.
      expect(evaluateCoach(input({ ...deep, alliesHere: 1 }), {}, {})?.id).not.toBe('overextended')
      // With vision you can see what is coming.
      expect(evaluateCoach(input({ ...deep, routeVision: 6 }), {}, {})?.id).not.toBe('overextended')
      // Near home it is not deep.
      expect(evaluateCoach(input({ ...deep, hopIndex: 1 }), {}, {})?.id).not.toBe('overextended')
    })

    it('teaches last-hitting only when there is a wave worth taking', () => {
      const green = { lastHits: 0, strippableWaves: 0 }
      expect(evaluateCoach(input(green), {}, {})).toBeNull()
      expect(evaluateCoach(input({ ...green, strippableWaves: 2 }), {}, {})?.id).toBe('last_hit')
    })

    it('mentions unspent scrip only where it can actually be spent', () => {
      const rich = { scrip: 1400, items: [null, null, null, null, null, null] }
      expect(evaluateCoach(input({ ...rich, inShopZone: false }), {}, {})?.id).not.toBe(
        'spend_scrip',
      )
      expect(evaluateCoach(input({ ...rich, inShopZone: true }), {}, {})?.id).toBe('spend_scrip')
    })
  })

  describe('it retires a lesson the player has demonstrated', () => {
    it('stops teaching last-hits once the player has taken a few', () => {
      const s = input({ lastHits: 0, strippableWaves: 3 })
      expect(evaluateCoach(s, {}, {})?.id).toBe('last_hit')
      expect(evaluateCoach({ ...s, lastHits: 5 }, {}, {})).toBeNull()
    })

    it('stops teaching abilities once the player has cast a few', () => {
      const s = input({ castsMade: 0, enemiesHere: 1, hpFraction: 1 })
      expect(evaluateCoach(s, {}, {})?.id).toBe('use_abilities')
      expect(evaluateCoach({ ...s, castsMade: 9 }, {}, {})).toBeNull()
    })

    it('reports what was just demonstrated so it retires permanently', () => {
      // Proven-by-doing, not by being shown: the player who last-hits without
      // ever seeing the tip should never see it either.
      const proved = newlyLearned(input({ lastHits: 9, castsMade: 9 }), {})
      expect(proved).toContain('last_hit')
      expect(proved).toContain('use_abilities')
      expect(newlyLearned(input({ lastHits: 9 }), { last_hit: true })).not.toContain('last_hit')
    })
  })

  describe('priority', () => {
    it('puts survival above economy when both are true', () => {
      const bleeding = input({
        hpFraction: 0.2,
        enemiesHere: 2,
        scrip: 2000,
        inShopZone: true,
        items: [null, null, null, null, null, null],
        lastHits: 0,
        strippableWaves: 3,
      })
      expect(evaluateCoach(bleeding, {}, {})?.id).toBe('retreat')
    })
  })

  describe('every tip is usable', () => {
    it('states a reason, not just an instruction', () => {
      // A tip that only says "press X" teaches nothing. Each must carry a WHY,
      // which in practice means it cannot be one short clause.
      const situations: CoachInput[] = [
        input({ hpFraction: 0.2, enemiesHere: 2 }),
        input({ hopIndex: 6, alliesHere: 0, routeVision: 1 }),
        input({ onRoute: false, inShopZone: true, cycle: 20 }),
        input({ lastHits: 0, strippableWaves: 2 }),
        input({ scrip: 1400, inShopZone: true, items: [null, null, null, null, null, null] }),
        input({ castsMade: 0, enemiesHere: 1 }),
        input({ routeVision: 1, routeTotal: 8, scrip: 200, items: [null, null] }),
        input({ attackableIce: true }),
      ]
      const seen = new Set<string>()
      for (const s of situations) {
        const tip = evaluateCoach(s, {}, {})
        if (!tip) continue
        seen.add(tip.id)
        expect(tip.text.startsWith('[COACH]'), `${tip.id} is not tagged`).toBe(true)
        expect(tip.text.split(/\s+/).length, `${tip.id} is too terse to explain`).toBeGreaterThan(
          15,
        )
      }
      // The situations above should between them reach most of the catalogue —
      // a tip no situation can produce is a tip that never fires.
      expect(seen.size).toBeGreaterThanOrEqual(6)
    })

    it('every catalogued tip has a unique id', () => {
      expect(new Set(COACH_TIP_IDS).size).toBe(COACH_TIP_IDS.length)
    })
  })
})
