import { describe, it, expect } from 'vitest'
import {
  computeThreat,
  threatToneClass,
  recommendAction,
  incomingDamageLastCycle,
  incomingDamageBreakdownLastCycle,
  zoneVerdict,
} from '~~/app/utils/tactics'
import type { ZoneThreat } from '~~/app/utils/tactics'

describe('computeThreat', () => {
  it('is CLEAR with no enemies and no enemy ice', () => {
    expect(computeThreat(0, 1, false)).toEqual({ label: 'CLEAR', tone: 'safe' })
  })

  it('is ICE (warn) with no enemy heroes but an enemy ice present', () => {
    expect(computeThreat(0, 1, true)).toEqual({ label: 'ICE', tone: 'warn' })
  })

  it('is DANGER when enemies outnumber the allied headcount', () => {
    expect(computeThreat(2, 1, false)).toEqual({ label: 'DANGER', tone: 'danger' })
  })

  it('is CONTESTED when enemies equal the allied headcount', () => {
    expect(computeThreat(1, 1, false)).toEqual({ label: 'CONTESTED', tone: 'warn' })
    expect(computeThreat(2, 2, false)).toEqual({ label: 'CONTESTED', tone: 'warn' })
  })

  it('is FAVORED when allies outnumber enemies', () => {
    expect(computeThreat(1, 2, false)).toEqual({ label: 'FAVORED', tone: 'safe' })
  })

  it('ignores an enemy ice once enemy heroes are present (heroes drive the verdict)', () => {
    expect(computeThreat(2, 1, true)).toEqual({ label: 'DANGER', tone: 'danger' })
  })
})

describe('threatToneClass', () => {
  it('maps each tone to its color class', () => {
    expect(threatToneClass('danger')).toBe('text-audit')
    expect(threatToneClass('warn')).toBe('text-gold')
    expect(threatToneClass('safe')).toBe('text-chaff')
  })
})

describe('recommendAction', () => {
  const threat = (label: ZoneThreat['label']): ZoneThreat => ({
    label,
    tone:
      label === 'DANGER' ? 'danger' : label === 'CLEAR' || label === 'FAVORED' ? 'safe' : 'warn',
  })

  it('does not call a missing hero "dead"', () => {
    const r = recommendAction({
      alive: false,
      hpFraction: 0,
      threat: threat('CLEAR'),
      hasReadyAbility: false,
      hasHero: false,
    })
    expect(r).toContain('Waiting for the first cycle')
    expect(r).not.toContain('Dead')
  })

  it('prioritises being dead above everything', () => {
    const r = recommendAction({
      alive: false,
      hpFraction: 1,
      threat: threat('FAVORED'),
      hasReadyAbility: true,
    })
    expect(r).toContain('Dead')
  })

  it('prioritises low INTEG over the threat verdict (when alive)', () => {
    const r = recommendAction({
      alive: true,
      hpFraction: 0.25,
      threat: threat('FAVORED'),
      hasReadyAbility: true,
    })
    expect(r).toContain('Low INTEG')
  })

  it('advises retreat when outnumbered', () => {
    const r = recommendAction({
      alive: true,
      hpFraction: 1,
      threat: threat('DANGER'),
      hasReadyAbility: false,
    })
    expect(r).toContain('retreat')
  })

  it('mentions an ability in a contested fight only when one is ready', () => {
    const ready = recommendAction({
      alive: true,
      hpFraction: 1,
      threat: threat('CONTESTED'),
      hasReadyAbility: true,
    })
    const notReady = recommendAction({
      alive: true,
      hpFraction: 1,
      threat: threat('CONTESTED'),
      hasReadyAbility: false,
    })
    expect(ready).toContain('ability')
    expect(notReady).not.toContain('ability')
  })

  it('encourages pressing the advantage when favored', () => {
    const r = recommendAction({
      alive: true,
      hpFraction: 0.9,
      threat: threat('FAVORED'),
      hasReadyAbility: true,
    })
    expect(r).toContain('advantage')
  })

  it('falls back to farm/push/rotate when clear', () => {
    const r = recommendAction({
      alive: true,
      hpFraction: 1,
      threat: threat('CLEAR'),
      hasReadyAbility: true,
    })
    expect(r.toLowerCase()).toContain('farm')
  })
})

// Playtest 2026-10 (28.png / 29.png): the banner said "You have the advantage —
// press it · FAVORED (2 hostile)" at 24% INTEG with two enemies on the player,
// and "Dead — wait for respawn · FAVORED (1 hostile)" while dead. Headcount
// alone decided the verdict.
describe('the verdict reads the hero, not just the headcount', () => {
  const me = { id: 'me', zone: 'cs', alive: true, integ: 550, maxInteg: 550, team: 'chaff' }
  const ally = (id: string, integ = 500) => ({ id, zone: 'cs', alive: true, integ, team: 'chaff' })
  const enemy = (id: string, integ = 500) => ({ id, zone: 'cs', alive: true, integ, team: 'audit' })
  const verdict = (
    over: Partial<typeof me>,
    incoming: number,
    enemies = [enemy('e1'), enemy('e2')],
  ) =>
    zoneVerdict({
      me: { ...me, ...over },
      allies: [ally('a1'), ally('a2')],
      enemies,
      enemyIcePresent: false,
      incomingLastCycle: incoming,
      hasReadyAbility: true,
    })

  it('254/550 taking 105 a cycle in a 3v2 is not FAVORED', () => {
    const v = verdict({ integ: 254 }, 105)
    expect(v.threat.label).not.toBe('FAVORED')
    expect(v.action).not.toContain('advantage')
  })

  it('194/550 taking 60 a cycle in a 3v2 is not FAVORED', () => {
    const v = verdict({ integ: 194 }, 60)
    expect(v.threat.label).not.toBe('FAVORED')
    expect(v.action).not.toContain('advantage')
  })

  it('134/550 (24%) with two enemies on you is DANGER and says retreat', () => {
    const v = verdict({ integ: 134 }, 60)
    expect(v.threat.label).toBe('DANGER')
    expect(v.action).toContain('retreat')
  })

  it('a healthy 3v2 with more INTEG standing stays FAVORED', () => {
    const v = verdict({ integ: 464 }, 86)
    expect(v.threat.label).toBe('FAVORED')
  })

  it('a 3v2 against fresher enemies is only CONTESTED', () => {
    const v = verdict({ integ: 500 }, 0, [enemy('e1', 900), enemy('e2', 900)])
    expect(v.threat.label).toBe('CONTESTED')
  })

  it('a burst that would finish you in three cycles is DANGER even at high INTEG', () => {
    const v = verdict({ integ: 400 }, 150)
    expect(v.threat.label).toBe('DANGER')
    // Not "Outnumbered" — it is a 3v2; the burst is the reason.
    expect(v.action).toContain('heavy fire')
  })

  it('a dead hero is DOWN — never FAVORED — and is not counted as a body', () => {
    const v = verdict({ integ: 0, alive: false }, 0, [enemy('e1')])
    expect(v.threat.label).toBe('DOWN')
    expect(v.action).toContain('Dead')
    expect(v.allyHeadcount).toBe(2)
  })

  it('computeThreat never returns FAVORED for a dead or low hero', () => {
    expect(computeThreat(1, 3, false, { alive: false }).label).toBe('DOWN')
    expect(computeThreat(1, 3, false, { alive: true, hpFraction: 0.3 }).label).toBe('DANGER')
  })
})

describe('incomingDamageLastCycle', () => {
  const dmg = (cycle: number, targetId: string, amount: number) => ({
    type: 'damage',
    cycle,
    payload: { sourceId: 'x', targetId, amount },
  })

  it('sums only the newest resolved cycle of hits on me', () => {
    const events = [dmg(18, 'me', 500), dmg(19, 'me', 60), dmg(19, 'me', 45), dmg(19, 'ally', 99)]
    expect(incomingDamageLastCycle(events, 'me', 20)).toBe(105)
  })

  it('is zero when the newest cycle had no hits on me', () => {
    const events = [dmg(18, 'me', 500), dmg(19, 'ally', 99)]
    expect(incomingDamageLastCycle(events, 'me', 19)).toBe(0)
  })

  it('does not keep reporting an old burst once the fight is two cycles stale', () => {
    expect(incomingDamageLastCycle([dmg(10, 'me', 300)], 'me', 20)).toBe(0)
  })
})

describe('no enemy HEROES is not safety (review B2C-2)', () => {
  const me = { id: 'me', zone: 'cs', alive: true, integ: 550, maxInteg: 550, team: 'chaff' }
  const solo = (over: Partial<typeof me>, incoming: number, ice: boolean) =>
    zoneVerdict({
      me: { ...me, ...over },
      allies: [],
      enemies: [],
      enemyIcePresent: ice,
      incomingLastCycle: incoming,
      hasReadyAbility: true,
    })

  it('10% INTEG under ICE fire is DANGER, not a calm ICE warning', () => {
    const v = solo({ integ: 55 }, 40, true)
    expect(v.threat).toEqual({ label: 'DANGER', tone: 'danger' })
    expect(v.action).toContain('Low INTEG')
  })

  it('a wave / Tenant burst with no heroes around is DANGER, never green CLEAR + "retreat now"', () => {
    const v = solo({ integ: 300 }, 150, false)
    expect(v.threat.label).toBe('DANGER')
    expect(v.action).toContain('retreat now')
  })

  it('low INTEG alone, with nothing hitting you and no ICE, is still CLEAR', () => {
    expect(solo({ integ: 55 }, 0, false).threat.label).toBe('CLEAR')
    // ...and a healthy hero under ICE keeps the plain ICE warning.
    expect(solo({}, 0, true).threat).toEqual({ label: 'ICE', tone: 'warn' })
  })

  it('a hero whose max INTEG is not known yet reads CLEAR and is not told "Low INTEG"', () => {
    const v = solo({ integ: 0, maxInteg: 0 }, 0, false)
    expect(v.threat.label).toBe('CLEAR')
    expect(v.action).not.toContain('Low INTEG')
    // Unknown INTEG must not turn a stray hit into a "lethal burst" either.
    expect(solo({ integ: 0, maxInteg: 0 }, 20, false).threat.label).toBe('CLEAR')
  })
})

describe('an equal headcount still compares INTEG (review B2C-3)', () => {
  const me = { id: 'me', zone: 'cs', alive: true, integ: 600, maxInteg: 600, team: 'chaff' }
  const enemy = (integ: number) => ({
    id: 'e1',
    zone: 'cs',
    alive: true,
    integ,
    maxInteg: 600,
    team: 'audit',
  })
  const duel = (over: Partial<typeof me>, e: ReturnType<typeof enemy>) =>
    zoneVerdict({
      me: { ...me, ...over },
      allies: [],
      enemies: [e],
      enemyIcePresent: false,
      incomingLastCycle: 0,
      hasReadyAbility: true,
    })

  it('a full-INTEG hero against one enemy at 50/600 is FAVORED, not an even fight', () => {
    const v = duel({}, enemy(50))
    expect(v.threat.label).toBe('FAVORED')
    expect(v.action).toContain('advantage')
  })

  it('a near-even 1v1 stays CONTESTED', () => {
    expect(duel({}, enemy(600)).threat.label).toBe('CONTESTED')
    expect(duel({ integ: 600 }, enemy(450)).threat.label).toBe('CONTESTED')
  })

  it('a 1v1 you lead on INTEG but cannot commit with (<= 50% INTEG) is not FAVORED', () => {
    expect(duel({ integ: 300 }, enemy(20)).threat.label).toBe('CONTESTED')
  })

  it('the headcount-only call (no INTEG known) is unchanged: CONTESTED', () => {
    expect(computeThreat(1, 1, false)).toEqual({ label: 'CONTESTED', tone: 'warn' })
  })
})

describe('incomingDamageLastCycle ignores damage I did to myself (review B2C-2)', () => {
  const ev = (
    cycle: number,
    sourceId: string,
    targetId: string,
    amount: number,
    damageType = 'kinetic',
  ) => ({ type: 'damage', cycle, payload: { sourceId, targetId, amount, damageType } })

  it("Malloc's Stack Overflow HP cost (self-sourced damage) is not incoming fire", () => {
    const events = [ev(20, 'me', 'me', 120), ev(20, 'e1', 'me', 30)]
    expect(incomingDamageLastCycle(events, 'me', 21)).toBe(30)
  })

  it('a Spite Plate reflect (black, mirrors my own hit on that attacker) is not incoming fire', () => {
    const events = [
      ev(20, 'me', 'e1', 90),
      ev(20, 'e1', 'me', 90, 'black'), // the reflect
      ev(20, 'e2', 'me', 40), // real fire from another enemy
    ]
    expect(incomingDamageLastCycle(events, 'me', 21)).toBe(40)
  })

  it('black damage that does NOT mirror one of my hits still counts', () => {
    const events = [ev(20, 'me', 'e1', 90), ev(20, 'e1', 'me', 75, 'black')]
    expect(incomingDamageLastCycle(events, 'me', 21)).toBe(75)
  })
})

describe('sustained wave / ICE fire is never FAVORED (playtest2 32.png)', () => {
  // Echo at Coldstore Crossing, alone with one (lower) enemy hero, eating
  // "Waves hit You ×4 for 118" every cycle. The banner said FAVORED both times.
  const me = { id: 'me', zone: 'cx', alive: true, integ: 480, maxInteg: 598, team: 'chaff' }
  const kernel = { id: 'k', zone: 'cx', alive: true, integ: 200, team: 'audit' }
  const v = (integ: number, npc: number, total = npc, enemies = [kernel]) =>
    zoneVerdict({
      me: { ...me, integ },
      allies: [],
      enemies,
      enemyIcePresent: false,
      incomingLastCycle: total,
      npcIncomingLastCycle: npc,
      hasReadyAbility: true,
    })

  it('480/598 taking 118 from waves is CONTESTED with an honest action', () => {
    const r = v(480, 118)
    expect(r.threat).toEqual({ label: 'CONTESTED', tone: 'warn' })
    expect(r.action).toBe('Waves are chewing you — step back or clear them')
  })

  it('362/598 taking 118 from waves is CONTESTED with the same action', () => {
    const r = v(362, 118)
    expect(r.threat.label).toBe('CONTESTED')
    expect(r.action).toBe('Waves are chewing you — step back or clear them')
  })

  it('with no enemy hero, the same wave fire is not a calm CLEAR', () => {
    const r = v(480, 118, 118, [])
    expect(r.threat.label).toBe('CONTESTED')
    expect(r.action).toBe('Waves are chewing you — step back or clear them')
  })

  it('a wave chip well under 15% of max INTEG keeps the advantage', () => {
    const r = v(480, 40)
    expect(r.threat.label).toBe('FAVORED')
  })

  it('a short time-to-death at the wave rate also vetoes FAVORED', () => {
    // 80/598 is only 13% a cycle: at 330 INTEG that is 4.1 cycles — fine;
    // at 310 it is 3.9 cycles — not a fight you are winning.
    const r = v(330, 80)
    expect(r.threat.label).toBe('FAVORED')
    const low = zoneVerdict({
      me: { ...me, integ: 310 },
      allies: [],
      enemies: [{ ...kernel, integ: 100 }],
      enemyIcePresent: false,
      incomingLastCycle: 80,
      npcIncomingLastCycle: 80,
      hasReadyAbility: true,
    })
    expect(low.threat.label).toBe('CONTESTED')
  })

  it('under enemy ICE with no hero around, the action names the ICE', () => {
    const r = zoneVerdict({
      me: { ...me, integ: 480 },
      allies: [],
      enemies: [],
      enemyIcePresent: true,
      incomingLastCycle: 118,
      npcIncomingLastCycle: 118,
      hasReadyAbility: true,
    })
    expect(r.threat.label).toBe('ICE')
    expect(r.action).toBe('Their ICE is chewing you — step back out of its zone')
  })

  it('the same number dealt by an enemy HERO is a duel, not wave pressure', () => {
    const r = v(480, 0, 118)
    expect(r.threat.label).toBe('FAVORED')
  })
})

describe('the pressure line names what is actually shooting (review r3 C2/C3)', () => {
  const me = { id: 'me', zone: 'cx', alive: true, integ: 480, maxInteg: 598, team: 'chaff' }
  const ally = { id: 'a', zone: 'cx', alive: true, integ: 500, maxInteg: 600, team: 'chaff' }
  const kernel = { id: 'k', zone: 'cx', alive: true, integ: 200, team: 'audit' }

  it('ICE fire with an enemy hero present (CONTESTED) names the ICE, not the waves', () => {
    const r = zoneVerdict({
      me,
      allies: [],
      enemies: [kernel],
      enemyIcePresent: true,
      incomingLastCycle: 118,
      npcIncomingLastCycle: 118,
      iceIncomingLastCycle: 118,
      hasReadyAbility: true,
    })
    expect(r.threat.label).toBe('CONTESTED')
    expect(r.action).toBe('Their ICE is chewing you — step back out of its zone')
  })

  it('wave fire under an ICE that is shooting someone else names the waves', () => {
    const r = zoneVerdict({
      me,
      allies: [],
      enemies: [],
      enemyIcePresent: true,
      incomingLastCycle: 118,
      npcIncomingLastCycle: 118,
      iceIncomingLastCycle: 0,
      hasReadyAbility: true,
    })
    expect(r.action).toBe('Waves are chewing you — step back or clear them')
  })

  it('allies outnumbering the enemy is still not FAVORED under ≥15% max-INTEG NPC fire', () => {
    const r = zoneVerdict({
      me,
      allies: [ally],
      enemies: [kernel],
      enemyIcePresent: false,
      incomingLastCycle: 100,
      npcIncomingLastCycle: 100, // 100/598 ≈ 17%
      hasReadyAbility: true,
    })
    expect(r.allyHeadcount).toBe(2)
    expect(r.threat).toEqual({ label: 'CONTESTED', tone: 'warn' })
    // ...and the same fire under the threshold leaves the advantage alone.
    const chip = zoneVerdict({
      me,
      allies: [ally],
      enemies: [kernel],
      enemyIcePresent: false,
      incomingLastCycle: 40,
      npcIncomingLastCycle: 40,
      hasReadyAbility: true,
    })
    expect(chip.threat.label).toBe('FAVORED')
  })
})

describe('incomingDamageBreakdownLastCycle', () => {
  const ev = (cycle: number, sourceId: string, amount: number) => ({
    type: 'damage',
    cycle,
    payload: { sourceId, targetId: 'me', amount },
  })
  it('splits wave / ICE / Silt fire from hero fire', () => {
    const events = [
      ev(20, 'wave_1', 30),
      ev(20, 'wave_2', 28),
      ev(20, 'ice_coldstore-t1-audit', 95),
      ev(20, 'neutral_3', 10),
      ev(20, 'kernel_player', 55),
    ]
    expect(incomingDamageBreakdownLastCycle(events, 'me', 21)).toEqual({
      total: 218,
      npc: 163,
      ice: 95,
    })
    expect(incomingDamageLastCycle(events, 'me', 21)).toBe(218)
  })
})

// Playtest 3: "Even fight … CONTESTED" at 250/598, 1v1, inside the enemy ICE's
// zone with four hostile units. That is a losing dive, not an even fight.
describe('zoneVerdict: inside enemy ICE with their wave', () => {
  const me = {
    id: 'me',
    zone: 'coldstore-t1-audit',
    alive: true,
    integ: 250,
    maxInteg: 598,
    team: 'chaff',
  }
  const foe = { id: 'e1', zone: 'coldstore-t1-audit', alive: true, integ: 500, team: 'audit' }
  const verdict = (o: { integ?: number; waves?: number; ice?: boolean } = {}) =>
    zoneVerdict({
      me: { ...me, integ: o.integ ?? me.integ },
      allies: [],
      enemies: [foe],
      enemyIcePresent: o.ice ?? true,
      incomingLastCycle: 0,
      enemyWavesHere: o.waves ?? 4,
      hasReadyAbility: true,
    })

  it('the playtest case is DANGER with a step-back line, never "Even fight"', () => {
    const v = verdict()
    expect(v.threat.label).toBe('DANGER')
    expect(v.action).not.toMatch(/Even fight/)
    expect(v.action).toMatch(/ICE/)
  })

  it('also with no enemy hero there', () => {
    const v = zoneVerdict({
      me,
      allies: [],
      enemies: [],
      enemyIcePresent: true,
      incomingLastCycle: 0,
      enemyWavesHere: 2,
      hasReadyAbility: true,
    })
    expect(v.threat.label).toBe('DANGER')
  })

  it('pushing behind your OWN wave with the ICE busy on it is not a dive (round-4 review)', () => {
    const push = (o: { ice?: number; friendly?: number }) =>
      zoneVerdict({
        me,
        allies: [],
        enemies: [],
        enemyIcePresent: true,
        incomingLastCycle: o.ice ?? 0,
        npcIncomingLastCycle: o.ice ?? 0,
        iceIncomingLastCycle: o.ice ?? 0,
        enemyWavesHere: 2,
        friendlyWavesHere: o.friendly ?? 3,
        hasReadyAbility: true,
      })
    // 250/598, their wave AND ours here, the ICE shooting our units: no DANGER.
    const v = push({})
    expect(v.threat.label).not.toBe('DANGER')
    expect(v.action).not.toMatch(/Under their ICE with their wave/)
    // The ICE turned on you last cycle: it is a dive again.
    expect(push({ ice: 40 }).threat.label).toBe('DANGER')
    expect(push({ ice: 40 }).action).toMatch(/Under their ICE with their wave/)
    // No friendly unit for it to shoot first: a dive.
    expect(push({ friendly: 0 }).threat.label).toBe('DANGER')
  })

  it('needs all three: ICE, hostile units, and ≤ half INTEG', () => {
    expect(verdict({ waves: 0 }).threat.label).toBe('CONTESTED')
    expect(verdict({ ice: false }).threat.label).toBe('CONTESTED')
    expect(verdict({ integ: 400 }).threat.label).toBe('CONTESTED')
  })
})

describe('the predicted fire next cycle (round 5: 12 units, 550 → 10)', () => {
  const me = { id: 'me', zone: 'cs', alive: true, integ: 550, maxInteg: 550, team: 'chaff' }
  const at = (predictedIncoming: number | undefined, over: Partial<typeof me> = {}) =>
    zoneVerdict({
      me: { ...me, ...over },
      allies: [],
      enemies: [],
      enemyIcePresent: false,
      incomingLastCycle: 0,
      enemyWavesHere: 12,
      predictedIncoming,
      hasReadyAbility: true,
    })

  it('a lethal prediction at full INTEG is DANGER with the number and "leave now"', () => {
    const v = at(560)
    expect(v.threat).toEqual({ label: 'DANGER', tone: 'danger' })
    expect(v.action).toBe('~560 incoming next cycle — leave now')
  })

  it('exactly your INTEG is lethal; one under is not', () => {
    expect(at(550).action).toContain('leave now')
    expect(at(549).action).not.toContain('leave now')
    expect(at(549).threat.label).not.toBe('DANGER')
  })

  it('without a prediction the verdict is unchanged', () => {
    expect(at(undefined).threat.label).toBe('CLEAR')
    expect(at(0).action).not.toContain('incoming')
  })

  it('dead outranks it', () => {
    expect(at(900, { alive: false }).threat.label).toBe('DOWN')
  })
})
