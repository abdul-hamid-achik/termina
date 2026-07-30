import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { resolveActions, type PlayerAction } from '~~/server/game/engine/ActionResolver'
import type { GameState, PlayerState } from '~~/shared/types/game'
import { initializeZoneStates, initializeIce } from '~~/server/game/map/zones'
import { getDistance } from '~~/server/game/map/topology'
import { initializeTenant } from '~~/server/game/map/spawner'
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
  FRACTURE_EDGE_CRIT_MULTIPLIER,
  KILLSHOT_COIL_CRIT_MULTIPLIER,
  RUST_DRIVER_ARMOR_REDUCTION,
  SIEGE_LATTICE_AURA_DEFENSE,
  BULWARK_PLATE_BLOCK_AMOUNT,
  TRUESTRIKE_RIG_BONUS_DAMAGE,
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
    team: 'chaff',
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
    iceDamageDealt: 0,
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
      chaff: { id: 'chaff', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
      audit: { id: 'audit', kills: 0, iceKills: 0, gold: 0, hardenUsedTick: null },
    },
    players: {},
    zones: initializeZoneStates(),
    waves: [],
    neutrals: [],
    ice: initializeIce(),
    ancients: initializeAncients(),
    caches: [],
    tenant: initializeTenant(),
    backup: null,
    events: [],
    surrenderVotes: { chaff: new Set(), audit: new Set() },
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
        p1: makePlayer({ id: 'p1', team: 'chaff', items: [item, null, null, null, null, null] }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Enemy' }),
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

  it('fracture_edge crits for 1.75x at least once over 50 attacks (20% chance)', () => {
    const normal = expectedPhysical(['fracture_edge'], [])
    const crit = expectedPhysical(['fracture_edge'], [], FRACTURE_EDGE_CRIT_MULTIPLIER)
    let sawCrit = false
    for (let i = 0; i < 50; i++) {
      const state = duel('fracture_edge')
      const start = state.players['p2']!.hp
      const r = run(state, [attack('p1', 'Enemy')])
      const dmg = start - r.state.players['p2']!.hp
      expect([normal, crit]).toContain(dmg)
      if (dmg === crit) sawCrit = true
    }
    expect(sawCrit).toBe(true)
  })

  it('killshot_coil crits for 2.4x at least once over 50 attacks (30% chance)', () => {
    const normal = expectedPhysical(['killshot_coil'], [])
    const crit = expectedPhysical(['killshot_coil'], [], KILLSHOT_COIL_CRIT_MULTIPLIER)
    let sawCrit = false
    for (let i = 0; i < 50; i++) {
      const state = duel('killshot_coil')
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
  it('truestrike_rig adds a separate magical on-hit damage event (+50 pre-mitigation)', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          items: ['truestrike_rig', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Enemy' }),
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
      TRUESTRIKE_RIG_BONUS_DAMAGE,
      getEffectiveMagicResist(tgt, getItemStatBonuses([])),
    )
    expect((magic as { amount: number }).amount).toBe(expectedMagic)
    // Total HP lost = physical + magical.
    const lost = start - r.state.players['p2']!.hp
    expect(lost).toBe((phys as { amount: number }).amount + (magic as { amount: number }).amount)
  })

  it('rust_driver shreds 5 armor so the hit lands harder than a no-item hit', () => {
    const noShred = expectedPhysical([], [])
    const shredded = expectedPhysical(['rust_driver'], [], 1, RUST_DRIVER_ARMOR_REDUCTION)
    // Even ignoring rust_driver's +50 attack, the armor shred alone raises the
    // post-mitigation number — assert the real attack does at least the shred path.
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          items: ['rust_driver', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Enemy' }),
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

  it('arc_coil chain lightning hits a SECOND nearby enemy for magical damage (loop-50)', () => {
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
            team: 'chaff',
            items: ['arc_coil', null, null, null, null, null],
          }),
          p2: makePlayer({ id: 'p2', team: 'audit', name: 'Primary' }),
          p3: makePlayer({ id: 'p3', team: 'audit', name: 'Bystander' }),
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

  it('bulwark_plate blocks 50 damage on the proc (loop-50): a blocked hit lands lighter', () => {
    const unblocked = expectedPhysical([], ['bulwark_plate'])
    const blocked = Math.max(0, unblocked - BULWARK_PLATE_BLOCK_AMOUNT)
    expect(blocked).toBeLessThan(unblocked)
    let sawBlock = false
    let sawFull = false
    for (let i = 0; i < 50; i++) {
      const state = makeGameState({
        players: {
          p1: makePlayer({ id: 'p1', team: 'chaff' }),
          p2: makePlayer({
            id: 'p2',
            team: 'audit',
            name: 'Tank',
            items: ['bulwark_plate', null, null, null, null, null],
          }),
        },
      })
      const start = state.players['p2']!.hp
      const r = run(state, [attack('p1', 'Tank')])
      const dmg = start - r.state.players['p2']!.hp
      if (dmg === blocked) sawBlock = true
      else if (dmg === unblocked) sawFull = true
      else
        throw new Error(
          `unexpected bulwark_plate dmg ${dmg} (full=${unblocked} blocked=${blocked})`,
        )
    }
    expect(sawBlock).toBe(true)
    expect(sawFull).toBe(true)
  })

  it('siege_lattice aura shreds 5 armor off an enemy in the attacker zone', () => {
    // p1 (no items) attacks p2; a SECOND enemy of p2 (its zone-mate aura source)
    // carries siege_lattice, shredding p2's armor by 5.
    const withAura = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          items: ['siege_lattice', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Enemy' }),
      },
    })
    const start = withAura.players['p2']!.hp
    const r = run(withAura, [attack('p1', 'Enemy')])
    const dmg = start - r.state.players['p2']!.hp
    // attacker carries siege_lattice (+15 def, +200 hp on attacker — irrelevant
    // to its own outgoing) and the aura shreds the target's 3 base armor by 5 → 0.
    const expected = expectedPhysical(['siege_lattice'], [], 1, SIEGE_LATTICE_AURA_DEFENSE)
    expect(dmg).toBe(expected)
    // Sanity: shred makes it strictly more than the same attacker vs un-shredded armor.
    const unshredded = expectedPhysical(['siege_lattice'], [])
    expect(dmg).toBeGreaterThan(unshredded)
  })

  it('siege_lattice aura grants an ALLY in the victim zone +5 defense (was dead)', () => {
    // p1 (no items) attacks p2; p3, an ALLY of p2 sharing its zone, carries
    // siege_lattice — raising p2's defense by 5, so p2 takes LESS damage.
    const withAllyAura = makeGameState({
      players: {
        p1: makePlayer({ id: 'p1', team: 'chaff', name: 'Attacker' }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Victim' }),
        p3: makePlayer({
          id: 'p3',
          team: 'audit',
          name: 'AuraAlly',
          items: ['siege_lattice', null, null, null, null, null],
        }),
      },
    })
    const start = withAllyAura.players['p2']!.hp
    const r = run(withAllyAura, [attack('p1', 'Victim')])
    const dmg = start - r.state.players['p2']!.hp
    // negative shred = bonus armor on the target.
    const expected = expectedPhysical([], [], 1, -SIEGE_LATTICE_AURA_DEFENSE)
    expect(dmg).toBe(expected)
    // Strictly less than the same attack with no aura present.
    const noAura = expectedPhysical([], [])
    expect(dmg).toBeLessThan(noAura)
  })

  it('siege_lattice ally +5 and enemy -5 auras cancel to net zero', () => {
    // Both an enemy holder (p1) and an ally holder (p3) share the victim's zone.
    const bothAuras = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          name: 'Attacker',
          items: ['siege_lattice', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Victim' }),
        p3: makePlayer({
          id: 'p3',
          team: 'audit',
          name: 'AuraAlly',
          items: ['siege_lattice', null, null, null, null, null],
        }),
      },
    })
    const start = bothAuras.players['p2']!.hp
    const r = run(bothAuras, [attack('p1', 'Victim')])
    const dmg = start - r.state.players['p2']!.hp
    // +5 (ally) and -5 (enemy) cancel → same as the attacker's cuirass with no shred.
    expect(dmg).toBe(expectedPhysical(['siege_lattice'], []))
  })
})

// ── Active-item nukes / debuffs (use → effect) ──────────────────

describe('Item actives — direct effects', () => {
  it('burnout nukes the target for 300 magical (reduced by MR) in one use', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          items: ['burnout', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Enemy' }),
      },
    })
    const start = state.players['p2']!.hp
    const r = run(state, [
      {
        playerId: 'p1',
        command: { type: 'use', item: 'burnout', target: { kind: 'hero', name: 'Enemy' } },
      },
    ])
    const lost = start - r.state.players['p2']!.hp
    // 300 magical against echo's 15 MR.
    const expected = calculateMagicalDamage(300, 15)
    expect(lost).toBe(expected)
    expect(expected).toBeGreaterThan(250) // ~261 — close to 300 before reduction.
    // caster gets the cooldown buff.
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'item_cd_burnout')).toBe(true)
  })

  it('phase_shim end-to-end: target becomes physical-immune AND takes +40% magical', () => {
    // Tick 1: cast phase_shim on the enemy.
    const s1 = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          items: ['phase_shim', 'burnout', null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Enemy' }),
      },
    })
    const r1 = run(s1, [
      {
        playerId: 'p1',
        command: { type: 'use', item: 'phase_shim', target: { kind: 'hero', name: 'Enemy' } },
      },
    ])
    const target1 = r1.state.players['p2']!
    expect(target1.buffs.some((b) => b.id === 'ethereal')).toBe(true)
    expect(target1.buffs.find((b) => b.id === 'magic_vuln_40')?.stacks).toBe(40)

    // Tick 2a: a basic (physical) attack into the ethereal target deals 0.
    const s2 = makeGameState({ players: { p1: r1.state.players['p1']!, p2: target1 }, tick: 2 })
    const physResult = run(s2, [attack('p1', 'Enemy')])
    expect(physResult.state.players['p2']!.hp).toBe(target1.hp) // no physical damage

    // Tick 2b: a magical nuke (burnout 300) into the ethereal target is amplified +40%.
    const magResult = run(s2, [
      {
        playerId: 'p1',
        command: { type: 'use', item: 'burnout', target: { kind: 'hero', name: 'Enemy' } },
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
  it('shove_splice disengages the caster one zone toward their own fountain (deterministic)', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          zone: 'mid-river',
          items: ['shove_splice', null, null, null, null, null],
        }),
      },
    })
    const r = run(state, [{ playerId: 'p1', command: { type: 'use', item: 'shove_splice' } }])
    const newZone = r.state.players['p1']!.zone
    expect(newZone).not.toBe('mid-river')
    expect(['mid-t1-chaff', 'mid-t1-audit', 'cache-top', 'cache-bot']).toContain(newZone)
    // Disengage, not random: the push lands strictly CLOSER to the chaff
    // fountain than mid-river was (an earlier version shoved a random direction).
    expect(getDistance(newZone, 'chaff-fountain')).toBeLessThan(
      getDistance('mid-river', 'chaff-fountain'),
    )
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'item_cd_force_staff')).toBe(true)
  })

  it('kickback_splice pushes the caster away from a targeted enemy', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          zone: 'mid-river',
          items: ['kickback_splice', null, null, null, null, null],
        }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'Enemy', zone: 'mid-river' }),
      },
    })
    const r = run(state, [
      {
        playerId: 'p1',
        command: { type: 'use', item: 'kickback_splice', target: { kind: 'hero', name: 'Enemy' } },
      },
    ])
    const newZone = r.state.players['p1']!.zone
    expect(newZone).not.toBe('mid-river')
    // Disengage toward home, not a random direction: the push lands strictly
    // CLOSER to the chaff fountain than mid-river (and never onto the target).
    expect(getDistance(newZone, 'chaff-fountain')).toBeLessThan(
      getDistance('mid-river', 'chaff-fountain'),
    )
    // target stays put (push self away).
    expect(r.state.players['p2']!.zone).toBe('mid-river')
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'item_cd_hurricane_pike')).toBe(true)
    // post-thrust attack steroid (read in getEffectiveAttack)
    const steroid = r.state.players['p1']!.buffs.find((b) => b.id === 'kickback_splice_attacks')
    expect(steroid?.stacks).toBe(30)
  })
})

describe('Gait Rig toggle (was cosmetic — the mode buffs were read nowhere)', () => {
  const ptBuff = (id: string, stacks: number) => ({
    id,
    stacks,
    ticksRemaining: 9999,
    source: 'item',
  })

  it('attack mode (gait_rig_attack) raises effective attack by the buff stacks', () => {
    const base = getEffectiveAttack(makePlayer())
    const treaded = getEffectiveAttack(makePlayer({ buffs: [ptBuff('gait_rig_attack', 15)] }))
    expect(treaded - base).toBe(15)
  })

  it('hp mode (gait_rig_hp) raises maxHp through the resolveActions recalc', () => {
    const state = makeGameState({
      players: { p1: makePlayer({ buffs: [ptBuff('gait_rig_hp', 150)] }) },
    })
    const r = run(state, [])
    expect(r.state.players['p1']!.maxHp).toBe(ECHO_BASE_HP + 150)
  })

  it('mp mode (gait_rig_mp) raises maxMp through the resolveActions recalc', () => {
    const state = makeGameState({
      players: { p1: makePlayer({ buffs: [ptBuff('gait_rig_mp', 100)] }) },
    })
    const r = run(state, [])
    expect(r.state.players['p1']!.maxMp).toBe(ECHO_BASE_MP + 100)
  })
})

describe('Backup pickup through resolveActions (was dropping ground-removal + event)', () => {
  const backupGround = { zone: 'hollow', tick: 100, holderId: null }

  it('picking up backup in hollow nulls state.backup, emits backup_picked, applies the buff', () => {
    const state = makeGameState({
      tick: 120,
      backup: backupGround,
      players: { p1: makePlayer({ id: 'p1', zone: 'hollow' }) },
    })
    const r = run(state, [{ playerId: 'p1', command: { type: 'backup' } }])
    expect(r.state.backup).toBeNull()
    expect(r.events.some((e) => e._tag === 'backup_picked' && e.playerId === 'p1')).toBe(true)
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'backup')).toBe(true)
  })

  it('two pickups the same tick cannot double-dip — only one player gets backup', () => {
    const state = makeGameState({
      tick: 120,
      backup: backupGround,
      players: {
        p1: makePlayer({ id: 'p1', zone: 'hollow' }),
        p2: makePlayer({ id: 'p2', team: 'audit', zone: 'hollow' }),
      },
    })
    const r = run(state, [
      { playerId: 'p1', command: { type: 'backup' } },
      { playerId: 'p2', command: { type: 'backup' } },
    ])
    expect(r.state.backup).toBeNull()
    const withBackup = ['p1', 'p2'].filter((id) =>
      r.state.players[id]!.buffs.some((b) => b.id === 'backup'),
    )
    expect(withBackup).toHaveLength(1)
  })
})

describe('Cryo Routine active (was a dead effect — buffs consumed nowhere)', () => {
  const shiva = (overrides = {}) =>
    makePlayer({
      id: 'p1',
      team: 'chaff',
      items: ['cryo_routine', null, null, null, null, null],
      ...overrides,
    })
  const useShiva = { playerId: 'p1', command: { type: 'use' as const, item: 'cryo_routine' } }

  it('Arctic Blast damages AND slows every in-zone enemy', () => {
    const state = makeGameState({
      players: {
        p1: shiva(),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'E1', zone: 'mid-river' }),
        p3: makePlayer({ id: 'p3', team: 'audit', name: 'E2', zone: 'mid-river' }),
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
        ally: makePlayer({ id: 'ally', team: 'chaff', zone: 'mid-river' }),
        far: makePlayer({ id: 'far', team: 'audit', zone: 'audit-base' }),
      },
    })
    const [allyHp, farHp] = [state.players['ally']!.hp, state.players['far']!.hp]
    const r = run(state, [useShiva])
    expect(r.state.players['ally']!.hp).toBe(allyHp)
    expect(r.state.players['far']!.hp).toBe(farHp)
  })

  it('deals no magical damage to a magic-immune (Hardshell) enemy, but still slows it', () => {
    const state = makeGameState({
      players: {
        p1: shiva(),
        bkb: makePlayer({
          id: 'bkb',
          team: 'audit',
          name: 'Immune',
          zone: 'mid-river',
          buffs: [{ id: 'magic_immune', stacks: 1, ticksRemaining: 4, source: 'hardshell' }],
        }),
      },
    })
    const hp0 = state.players['bkb']!.hp
    const r = run(state, [useShiva])
    // Magical nova is fully absorbed by spell immunity...
    expect(r.state.players['bkb']!.hp).toBe(hp0)
    // ...but the slow still lands (Hardshell lets you ACT through controls; it doesn't
    // block slow application in this engine — same as every other slow source).
    expect(r.state.players['bkb']!.buffs.some((b) => b.id === 'slow')).toBe(true)
  })

  it('is amplified by a magic-vulnerability debuff (e.g. Veil of Discord)', () => {
    const mk = (buffs: PlayerState['buffs']) =>
      makeGameState({
        players: {
          p1: shiva(),
          e: makePlayer({ id: 'e', team: 'audit', name: 'E', zone: 'mid-river', buffs }),
        },
      })
    const plain = mk([])
    const veiled = mk([
      { id: 'veil_discord', stacks: 25, ticksRemaining: 4, source: 'discord_routine' },
    ])
    const dmgPlain = plain.players['e']!.hp - run(plain, [useShiva]).state.players['e']!.hp
    const dmgVeiled = veiled.players['e']!.hp - run(veiled, [useShiva]).state.players['e']!.hp
    expect(dmgVeiled).toBeGreaterThan(dmgPlain)
  })
})

describe('Cache effects (dd / haste were applied but consumed nowhere)', () => {
  const moveAudit = { playerId: 'p1', command: { type: 'move' as const, zone: 'mid-t1-audit' } }

  it('Double Damage cache (dd) doubles basic-attack damage', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          buffs: [{ id: 'dd', stacks: 1, ticksRemaining: 9999, source: 'cache_dd' }],
        }),
        p2: makePlayer({ id: 'p2', team: 'audit', name: 'E' }),
      },
    })
    const ddDmg = state.players['p2']!.hp - run(state, [attack('p1', 'E')]).state.players['p2']!.hp
    // matches the production formula with a 2x attack multiplier, and exceeds a normal hit
    expect(ddDmg).toBe(expectedPhysical([], [], 2))
    expect(ddDmg).toBeGreaterThan(expectedPhysical([], []))
  })

  it('Haste cache makes movement immune to slow (an 80% slow never fails the move)', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          zone: 'mid-river',
          buffs: [
            { id: 'slow', stacks: 80, ticksRemaining: 9999, source: 'x' },
            { id: 'haste', stacks: 1, ticksRemaining: 9999, source: 'cache_haste' },
          ],
        }),
      },
    })
    for (let i = 0; i < 20; i++) {
      expect(run(state, [moveAudit]).state.players['p1']!.zone).toBe('mid-t1-audit')
    }
  })

  it('control: WITHOUT haste, an 80% slow blocks the move on some ticks (deterministic pattern)', () => {
    // Slow blocks when (tick * stacks) % 100 < stacks. Sweep distinct ticks so
    // the deterministic pattern produces both blocks and passes; an 80% slow
    // blocks the large majority of ticks.
    let failedAtLeastOnce = false
    let passedAtLeastOnce = false
    for (let tick = 1; tick <= 20; tick++) {
      const state = makeGameState({
        tick,
        players: {
          p1: makePlayer({
            id: 'p1',
            team: 'chaff',
            zone: 'mid-river',
            buffs: [{ id: 'slow', stacks: 80, ticksRemaining: 9999, source: 'x' }],
          }),
        },
      })
      const zone = run(state, [moveAudit]).state.players['p1']!.zone
      if (zone === 'mid-river') failedAtLeastOnce = true
      if (zone === 'mid-t1-audit') passedAtLeastOnce = true
    }
    expect(failedAtLeastOnce).toBe(true)
    expect(passedAtLeastOnce).toBe(true)
  })
})

describe('Refresher Orb active resets all ability cooldowns', () => {
  it('use redline_splice zeroes q/w/e/r and goes on its own cooldown', () => {
    const state = makeGameState({
      players: {
        p1: makePlayer({
          id: 'p1',
          team: 'chaff',
          items: ['redline_splice', null, null, null, null, null],
          cooldowns: { q: 5, w: 3, e: 8, r: 20 },
        }),
      },
    })
    const r = run(state, [{ playerId: 'p1', command: { type: 'use', item: 'redline_splice' } }])
    expect(r.state.players['p1']!.cooldowns).toEqual({ q: 0, w: 0, e: 0, r: 0 })
    expect(r.state.players['p1']!.buffs.some((b) => b.id === 'item_cd_refresher_orb')).toBe(true)
  })
})
