import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { resolveActions, type PlayerAction } from '~~/server/game/engine/ActionResolver'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeTowers } from '~~/server/game/map/zones'
import { initializeRoshan } from '~~/server/game/map/spawner'
import { initializeAncients } from '~~/server/game/engine/AncientSystem'
import {
  getEffectiveAttack,
  getEffectiveDefense,
  getEffectiveMagicResist,
  getItemStatBonuses,
} from '~~/server/game/engine/EffectiveStats'
import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
} from '~~/server/game/engine/DamageCalculator'
import {
  NULL_POINTER_CRIT_MULTIPLIER,
  CRYSTALYS_CRIT_MULTIPLIER,
  DAEDALUS_CRIT_MULTIPLIER,
  DESOLATOR_ARMOR_REDUCTION,
  VANGUARD_BLOCK_AMOUNT,
  MKB_BONUS_DAMAGE,
} from '~~/shared/constants/balance'

// ── Harness ──────────────────────────────────────────────────────
// heroId 'echo' (base attack 58, defense 3, magicResist 15 at level 1; no
// combat buffs by default so getAttackMultiplier() === 1). All deltas are
// asserted against the real EffectiveStats / DamageCalculator formulas so the
// expected numbers track the production code, not magic constants.

// echo (level 1): base hp 550, mp 280. resolveActions recalculates maxHp/maxMp
// from hero base + item HP/MP and rescales hp/mp by percent if they differ — so
// we must set maxHp/maxMp to the TRUE value (and hp/mp to full) or the recalc
// silently mutates our deltas. This helper derives both from the chosen items.
const ECHO_BASE_HP = 550
const ECHO_BASE_MP = 280

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const items = overrides.items ?? [null, null, null, null, null, null]
  const itemStats = getItemStatBonuses(items)
  const maxHp = ECHO_BASE_HP + itemStats.hp
  const maxMp = ECHO_BASE_MP + itemStats.mp
  return {
    id: 'p1',
    name: 'Player1',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    level: 1,
    xp: 0,
    gold: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 3,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 100,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    tick: 1,
    phase: 'playing',
    teams: {
      radiant: { id: 'radiant', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
      dire: { id: 'dire', kills: 0, towerKills: 0, gold: 0, glyphUsedTick: null },
    },
    players: {},
    zones: initializeZoneStates(),
    creeps: [],
    neutrals: [],
    towers: initializeTowers(),
    ancients: initializeAncients(),
    runes: [],
    roshan: initializeRoshan(),
    aegis: null,
    events: [],
    surrenderVotes: { radiant: new Set(), dire: new Set() },
    lastSeen: {},
    timeOfDay: 'day',
    dayNightTick: 0,
    ...overrides,
  }
}

function attack(attackerId: string, targetName: string): PlayerAction {
  return {
    playerId: attackerId,
    command: { type: 'attack', target: { kind: 'hero', name: targetName } },
  }
}

function run(state: GameState, actions: PlayerAction[]) {
  return Effect.runSync(resolveActions(state, actions))
}

/** Physical damage a duel attacker deals against a fixed-stat target. */
function expectedPhysical(
  attackerItems: (string | null)[],
  targetItems: (string | null)[],
  critMult = 1,
  defenseShred = 0,
): number {
  const atk = makePlayer({ heroId: 'echo', items: attackerItems })
  const tgt = makePlayer({ heroId: 'echo', items: targetItems })
  const attackDamage = Math.round(
    Math.round(getEffectiveAttack(atk, getItemStatBonuses(attackerItems)) * 1) * critMult,
  )
  const defense = Math.max(
    0,
    getEffectiveDefense(tgt, getItemStatBonuses(targetItems)) - defenseShred,
  )
  return calculatePhysicalDamage(attackDamage, defense)
}

// ── CRIT multipliers (loop-50 RNG) ──────────────────────────────

describe('Item combat procs — crit multipliers', () => {
  function duel(item: string) {
    return makeGameState({
      players: {
        p1: makePlayer({ id: 'p1', team: 'radiant', items: [item, null, null, null, null, null] }),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'Enemy' }),
      },
    })
  }

  it('null_pointer crits for 1.5x at least once over 50 attacks (15% chance)', () => {
    const normal = expectedPhysical(['null_pointer'], [])
    const crit = expectedPhysical(['null_pointer'], [], NULL_POINTER_CRIT_MULTIPLIER)
    expect(crit).toBeGreaterThan(normal)
    let sawCrit = false
    let sawNormal = false
    for (let i = 0; i < 50; i++) {
      const state = duel('null_pointer')
      const start = state.players['p2']!.hp
      const r = run(state, [attack('p1', 'Enemy')])
      const dmg = start - r.state.players['p2']!.hp
      if (dmg === crit) sawCrit = true
      else if (dmg === normal) sawNormal = true
      else throw new Error(`unexpected null_pointer damage ${dmg} (normal=${normal} crit=${crit})`)
    }
    expect(sawNormal).toBe(true)
    expect(sawCrit).toBe(true)
  })

  it('crystalys crits for 1.75x at least once over 50 attacks (20% chance)', () => {
    const normal = expectedPhysical(['crystalys'], [])
    const crit = expectedPhysical(['crystalys'], [], CRYSTALYS_CRIT_MULTIPLIER)
    let sawCrit = false
    for (let i = 0; i < 50; i++) {
      const state = duel('crystalys')
      const start = state.players['p2']!.hp
      const r = run(state, [attack('p1', 'Enemy')])
      const dmg = start - r.state.players['p2']!.hp
      expect([normal, crit]).toContain(dmg)
      if (dmg === crit) sawCrit = true
    }
    expect(sawCrit).toBe(true)
  })

  it('daedalus crits for 2.4x at least once over 50 attacks (30% chance)', () => {
    const normal = expectedPhysical(['daedalus'], [])
    const crit = expectedPhysical(['daedalus'], [], DAEDALUS_CRIT_MULTIPLIER)
    let sawCrit = false
    for (let i = 0; i < 50; i++) {
      const state = duel('daedalus')
      const start = state.players['p2']!.hp
      const r = run(state, [attack('p1', 'Enemy')])
      const dmg = start - r.state.players['p2']!.hp
      expect([normal, crit]).toContain(dmg)
      if (dmg === crit) sawCrit = true
    }
    expect(sawCrit).toBe(true)
  })
})

// ── On-hit / proc passives ───────────────────────────────────────

describe('Item combat procs — on-hit effects', () => {
  it('monkey_king_bar adds a separate magical on-hit damage event (+50 pre-mitigation)', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          items: ['monkey_king_bar', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'Enemy' }),
      },
    })
    const start = state.players['p2']!.hp
    const r = run(state, [attack('p1', 'Enemy')])
    const events = r.events.filter((e) => e._tag === 'damage' && e.targetId === 'p2')
    const magic = events.find((e) => e._tag === 'damage' && e.damageType === 'magical')!
    const phys = events.find((e) => e._tag === 'damage' && e.damageType === 'physical')!
    expect(magic).toBeDefined()
    expect(phys).toBeDefined()
    // MKB magical = 50 reduced by the target's 15 MR.
    const tgt = makePlayer({ heroId: 'echo' })
    const expectedMagic = calculateMagicalDamage(
      MKB_BONUS_DAMAGE,
      getEffectiveMagicResist(tgt, getItemStatBonuses([])),
    )
    expect((magic as { amount: number }).amount).toBe(expectedMagic)
    // Total HP lost = physical + magical.
    const lost = start - r.state.players['p2']!.hp
    expect(lost).toBe((phys as { amount: number }).amount + (magic as { amount: number }).amount)
  })

  it('desolator shreds 5 armor so the hit lands harder than a no-item hit', () => {
    const noShred = expectedPhysical([], [])
    const shredded = expectedPhysical(['desolator'], [], 1, DESOLATOR_ARMOR_REDUCTION)
    // Even ignoring desolator's +50 attack, the armor shred alone raises the
    // post-mitigation number — assert the real attack does at least the shred path.
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          items: ['desolator', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'Enemy' }),
      },
    })
    const start = state.players['p2']!.hp
    const r = run(state, [attack('p1', 'Enemy')])
    const dmg = start - r.state.players['p2']!.hp
    // Desolator carries +50 attack AND -5 armor, so it must exceed the bare hit
    // and exceed even a no-item hit against shredded armor.
    expect(dmg).toBe(shredded)
    expect(dmg).toBeGreaterThan(noShred)
  })

  it('maelstrom chain lightning hits a SECOND nearby enemy for magical damage (loop-50)', () => {
    const tgt = makePlayer({ heroId: 'echo' })
    const expectedChain = calculateMagicalDamage(
      60,
      getEffectiveMagicResist(tgt, getItemStatBonuses([])),
    )
    let sawChain = false
    for (let i = 0; i < 50; i++) {
      const state = makeGameState({
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'radiant',
            items: ['maelstrom', null, null, null, null, null],
          }),
          p2: makePlayer({ id: 'p2', team: 'dire', name: 'Primary' }),
          p3: makePlayer({ id: 'p3', team: 'dire', name: 'Bystander' }),
        },
      })
      const startP3 = state.players['p3']!.hp
      const r = run(state, [attack('p1', 'Primary')])
      // chain damage lands on p3 (never the primary attack target).
      const chainDmg = startP3 - r.state.players['p3']!.hp
      if (chainDmg > 0) {
        expect(chainDmg).toBe(expectedChain)
        const chainEvent = r.events.find(
          (e) => e._tag === 'damage' && e.targetId === 'p3' && e.damageType === 'magical',
        )
        expect(chainEvent).toBeDefined()
        sawChain = true
        break
      }
    }
    expect(sawChain).toBe(true)
  })

  it('vanguard blocks 50 damage on the proc (loop-50): a blocked hit lands lighter', () => {
    const unblocked = expectedPhysical([], ['vanguard'])
    const blocked = Math.max(0, unblocked - VANGUARD_BLOCK_AMOUNT)
    expect(blocked).toBeLessThan(unblocked)
    let sawBlock = false
    let sawFull = false
    for (let i = 0; i < 50; i++) {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'radiant' }),
          p2: makePlayer({
            id: 'p2',
            team: 'dire',
            name: 'Tank',
            items: ['vanguard', null, null, null, null, null],
          }),
        },
      })
      const start = state.players['p2']!.hp
      const r = run(state, [attack('p1', 'Tank')])
      const dmg = start - r.state.players['p2']!.hp
      if (dmg === blocked) sawBlock = true
      else if (dmg === unblocked) sawFull = true
      else throw new Error(`unexpected vanguard dmg ${dmg} (full=${unblocked} blocked=${blocked})`)
    }
    expect(sawBlock).toBe(true)
    expect(sawFull).toBe(true)
  })

  it('assault_cuirass aura shreds 5 armor off an enemy in the attacker zone', () => {
    // p1 (no items) attacks p2; a SECOND enemy of p2 (its zone-mate aura source)
    // carries assault_cuirass, shredding p2's armor by 5.
    const withAura = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          items: ['assault_cuirass', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'Enemy' }),
      },
    })
    const start = withAura.players['p2']!.hp
    const r = run(withAura, [attack('p1', 'Enemy')])
    const dmg = start - r.state.players['p2']!.hp
    // attacker carries assault_cuirass (+15 def, +200 hp on attacker — irrelevant
    // to its own outgoing) and the aura shreds the target's 3 base armor by 5 → 0.
    const expected = expectedPhysical(['assault_cuirass'], [], 1, DESOLATOR_ARMOR_REDUCTION)
    expect(dmg).toBe(expected)
    // Sanity: shred makes it strictly more than the same attacker vs un-shredded armor.
    const unshredded = expectedPhysical(['assault_cuirass'], [])
    expect(dmg).toBeGreaterThan(unshredded)
  })
})

// ── Active-item nukes / debuffs (use → effect) ──────────────────

describe('Item actives — direct effects', () => {
  it('dagon nukes the target for 300 magical (reduced by MR) in one use', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          items: ['dagon', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'Enemy' }),
      },
    })
    const start = state.players['p2']!.hp
    const r = run(state, [
      {
        playerId: 'p1',
        command: { type: 'use', item: 'dagon', target: { kind: 'hero', name: 'Enemy' } },
      },
    ])
    const lost = start - r.state.players['p2']!.hp
    // 300 magical against echo's 15 MR.
    const expected = calculateMagicalDamage(300, 15)
    expect(lost).toBe(expected)
    expect(expected).toBeGreaterThan(250) // ~261 — close to 300 before reduction.
    // caster gets the cooldown buff.
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'item_cd_dagon')).toBe(true)
  })

  it('ethereal_blade end-to-end: target becomes physical-immune AND takes +40% magical', () => {
    // Tick 1: cast ethereal_blade on the enemy.
    const s1 = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          items: ['ethereal_blade', 'dagon', null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'Enemy' }),
      },
    })
    const r1 = run(s1, [
      {
        playerId: 'p1',
        command: { type: 'use', item: 'ethereal_blade', target: { kind: 'hero', name: 'Enemy' } },
      },
    ])
    const target1 = r1.state.players['p2']!
    expect(target1.buffs.some((b) => b.id === 'ethereal')).toBe(true)
    expect(target1.buffs.find((b) => b.id === 'magic_vuln_40')?.stacks).toBe(40)

    // Tick 2a: a basic (physical) attack into the ethereal target deals 0.
    const s2 = makeGameState({ players: { p1: r1.state.players['p1']!, p2: target1 }, tick: 2 })
    const physResult = run(s2, [attack('p1', 'Enemy')])
    expect(physResult.state.players['p2']!.hp).toBe(target1.hp) // no physical damage

    // Tick 2b: a magical nuke (dagon 300) into the ethereal target is amplified +40%.
    const magResult = run(s2, [
      {
        playerId: 'p1',
        command: { type: 'use', item: 'dagon', target: { kind: 'hero', name: 'Enemy' } },
      },
    ])
    const lost = target1.hp - magResult.state.players['p2']!.hp
    const baseMagic = calculateMagicalDamage(300, 15)
    const amped = Math.round(baseMagic * 1.4)
    expect(lost).toBe(amped)
    expect(lost).toBeGreaterThan(baseMagic) // the +40% really landed
  })
})

// ── Forced-movement actives (zone change) ───────────────────────

describe('Item actives — forced movement', () => {
  it('force_staff pushes the caster to an adjacent zone', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          zone: 'mid-river',
          items: ['force_staff', null, null, null, null, null],
        }),
      },
    })
    const r = run(state, [{ playerId: 'p1', command: { type: 'use', item: 'force_staff' } }])
    const newZone = r.state.players['p1']!.zone
    expect(newZone).not.toBe('mid-river')
    expect(['mid-t1-rad', 'mid-t1-dire', 'rune-top', 'rune-bot']).toContain(newZone)
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'item_cd_force_staff')).toBe(true)
  })

  it('hurricane_pike pushes the caster away from a targeted enemy', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          zone: 'mid-river',
          items: ['hurricane_pike', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'Enemy', zone: 'mid-river' }),
      },
    })
    const r = run(state, [
      {
        playerId: 'p1',
        command: { type: 'use', item: 'hurricane_pike', target: { kind: 'hero', name: 'Enemy' } },
      },
    ])
    const newZone = r.state.players['p1']!.zone
    expect(newZone).not.toBe('mid-river')
    // target stays put (push self away).
    expect(r.state.players['p2']!.zone).toBe('mid-river')
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'item_cd_hurricane_pike')).toBe(true)
  })
})

describe('Power Treads toggle (was cosmetic — the mode buffs were read nowhere)', () => {
  const ptBuff = (id: string, stacks: number) => ({
    id,
    stacks,
    ticksRemaining: 9999,
    source: 'item',
  })

  it('attack mode (power_treads_attack) raises effective attack by the buff stacks', () => {
    const base = getEffectiveAttack(makePlayer())
    const treaded = getEffectiveAttack(makePlayer({ buffs: [ptBuff('power_treads_attack', 15)] }))
    expect(treaded - base).toBe(15)
  })

  it('hp mode (power_treads_hp) raises maxHp through the resolveActions recalc', () => {
    const state = makeGameState({
      players: { p1: makePlayer({ buffs: [ptBuff('power_treads_hp', 150)] }) },
    })
    const r = run(state, [])
    expect(r.state.players['p1']!.maxHp).toBe(ECHO_BASE_HP + 150)
  })

  it('mp mode (power_treads_mp) raises maxMp through the resolveActions recalc', () => {
    const state = makeGameState({
      players: { p1: makePlayer({ buffs: [ptBuff('power_treads_mp', 100)] }) },
    })
    const r = run(state, [])
    expect(r.state.players['p1']!.maxMp).toBe(ECHO_BASE_MP + 100)
  })
})

describe('Aegis pickup through resolveActions (was dropping ground-removal + event)', () => {
  const aegisGround = { zone: 'roshan-pit', tick: 100, holderId: null }

  it('picking up aegis in roshan-pit nulls state.aegis, emits aegis_picked, applies the buff', () => {
    const state = makeGameState({
      tick: 120,
      aegis: aegisGround,
      players: { p1: makePlayer({ id: 'p1', zone: 'roshan-pit' }) },
    })
    const r = run(state, [{ playerId: 'p1', command: { type: 'aegis' } }])
    expect(r.state.aegis).toBeNull()
    expect(r.events.some((e) => e._tag === 'aegis_picked' && e.playerId === 'p1')).toBe(true)
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'aegis')).toBe(true)
  })

  it('two pickups the same tick cannot double-dip — only one player gets aegis', () => {
    const state = makeGameState({
      tick: 120,
      aegis: aegisGround,
      players: {
        p1: makePlayer({ id: 'p1', zone: 'roshan-pit' }),
        p2: makePlayer({ id: 'p2', team: 'dire', zone: 'roshan-pit' }),
      },
    })
    const r = run(state, [
      { playerId: 'p1', command: { type: 'aegis' } },
      { playerId: 'p2', command: { type: 'aegis' } },
    ])
    expect(r.state.aegis).toBeNull()
    const withAegis = ['p1', 'p2'].filter((id) =>
      r.state.players[id]!.buffs.some((b) => b.id === 'aegis'),
    )
    expect(withAegis).toHaveLength(1)
  })
})

describe("Shiva's Guard active (was a dead effect — buffs consumed nowhere)", () => {
  const shiva = (overrides = {}) =>
    makePlayer({
      id: 'p1',
      team: 'radiant',
      items: ['shivas_guard', null, null, null, null, null],
      ...overrides,
    })
  const useShiva = { playerId: 'p1', command: { type: 'use' as const, item: 'shivas_guard' } }

  it('Arctic Blast damages AND slows every in-zone enemy', () => {
    const state = makeGameState({
      players: {
        p1: shiva(),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'E1', zone: 'mid-river' }),
        p3: makePlayer({ id: 'p3', team: 'dire', name: 'E2', zone: 'mid-river' }),
      },
    })
    const [s2, s3] = [state.players['p2']!.hp, state.players['p3']!.hp]
    const r = run(state, [useShiva])
    expect(r.state.players['p2']!.hp).toBeLessThan(s2)
    expect(r.state.players['p3']!.hp).toBeLessThan(s3)
    expect(r.state.players['p2']!.buffs.some((b) => b.id === 'slow')).toBe(true)
    expect(r.state.players['p3']!.buffs.some((b) => b.id === 'slow')).toBe(true)
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'item_cd_shivas_guard')).toBe(true)
  })

  it('spares allies and out-of-zone enemies', () => {
    const state = makeGameState({
      players: {
        p1: shiva(),
        ally: makePlayer({ id: 'ally', team: 'radiant', zone: 'mid-river' }),
        far: makePlayer({ id: 'far', team: 'dire', zone: 'dire-base' }),
      },
    })
    const [allyHp, farHp] = [state.players['ally']!.hp, state.players['far']!.hp]
    const r = run(state, [useShiva])
    expect(r.state.players['ally']!.hp).toBe(allyHp)
    expect(r.state.players['far']!.hp).toBe(farHp)
  })
})

describe('Rune effects (dd / haste were applied but consumed nowhere)', () => {
  const moveDire = { playerId: 'p1', command: { type: 'move' as const, zone: 'mid-t1-dire' } }

  it('Double Damage rune (dd) doubles basic-attack damage', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          buffs: [{ id: 'dd', stacks: 1, ticksRemaining: 9999, source: 'rune_dd' }],
        }),
        p2: makePlayer({ id: 'p2', team: 'dire', name: 'E' }),
      },
    })
    const ddDmg = state.players['p2']!.hp - run(state, [attack('p1', 'E')]).state.players['p2']!.hp
    // matches the production formula with a 2x attack multiplier, and exceeds a normal hit
    expect(ddDmg).toBe(expectedPhysical([], [], 2))
    expect(ddDmg).toBeGreaterThan(expectedPhysical([], []))
  })

  it('Haste rune makes movement immune to slow (an 80% slow never fails the move)', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          zone: 'mid-river',
          buffs: [
            { id: 'slow', stacks: 80, ticksRemaining: 9999, source: 'x' },
            { id: 'haste', stacks: 1, ticksRemaining: 9999, source: 'rune_haste' },
          ],
        }),
      },
    })
    for (let i = 0; i < 20; i++) {
      expect(run(state, [moveDire]).state.players['p1']!.zone).toBe('mid-t1-dire')
    }
  })

  it('control: WITHOUT haste, an 80% slow fails the move at least once over 20 tries', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'radiant',
          zone: 'mid-river',
          buffs: [{ id: 'slow', stacks: 80, ticksRemaining: 9999, source: 'x' }],
        }),
      },
    })
    let failedAtLeastOnce = false
    for (let i = 0; i < 20; i++) {
      if (run(state, [moveDire]).state.players['p1']!.zone === 'mid-river') failedAtLeastOnce = true
    }
    expect(failedAtLeastOnce).toBe(true)
  })
})
