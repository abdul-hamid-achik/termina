import type { AbilityDef, AbilitySlot } from '../types/hero'
import type { TargetRef } from '../types/commands'
import type { TeamId } from '../types/game'
import { HEROES } from '../constants/heroes'
import { getAbilityLevel } from '../constants/balance'

/**
 * BW costs read straight off the hero registry, so every surface quotes the
 * number the engine will actually charge.
 *
 * The registry used to carry only the rank-1 `bwCost` while each hero
 * resolver kept a private per-rank table, so the HUD displayed — and the
 * command parser pre-validated — a cost up to 2.2x below the real one: a
 * player was told a cast was affordable and the server then refused it. The
 * tables live in the registry now and the resolvers read them from here too.
 */

/**
 * Cost per ability rank, indexed from rank 1. Abilities with a flat cost carry
 * no table in the registry and collapse to a single entry, which `scaleValue`
 * clamps to at every rank.
 *
 * Throws on an unknown hero/slot: the only callers are hero resolvers reading
 * their own id at module scope, so a miss is a typo, and failing at load beats
 * a cast that silently costs nothing.
 */
export function abilityBwTable(heroId: string, slot: AbilitySlot): readonly number[] {
  const def = HEROES[heroId]?.abilities[slot]
  if (!def) throw new Error(`Unknown hero ability: ${heroId}.${slot}`)
  return def.bwCostByLevel ?? [def.bwCost]
}

/**
 * What the engine will charge for `slot` at `playerLevel`.
 *
 * An unlearned ability (rank 0 — R below level 6) reports its rank-1 cost: the
 * level gate rejects that cast long before BW is checked, and previewing it
 * as free would read as castable.
 */
export function getAbilityBwCost(
  ability: AbilityDef,
  slot: AbilitySlot,
  playerLevel: number,
): number {
  const table = ability.bwCostByLevel
  if (!table || table.length === 0) return ability.bwCost
  const rank = Math.max(1, getAbilityLevel(playerLevel, slot))
  return table[Math.min(rank - 1, table.length - 1)] ?? ability.bwCost
}

/**
 * Which side of the board a single-hero ability may be aimed at.
 *
 * One answer for the engine (`resolveAbility` rejects before BW/cooldown are
 * spent) and the client (`validateCommand`, quick-cast auto-targeting), so a
 * Purge can't be thrown on an enemy and a Bind can't be thrown on a team-mate
 * by one side while the other says it is fine. `null` means the ability does
 * not take a hero target at all (self / none / zone casts).
 *
 *  - `ally`  → targetType 'ally' (self counts: you are on your own team —
 *              except the abilities in ALLY_NOT_SELF_ABILITY_IDS)
 *  - `enemy` → targetType 'hero'; every offensive single-target kit ability
 *  - `any`   → the one 'hero' ability that is deliberately team-agnostic
 */
export type AbilityTargetTeam = 'enemy' | 'ally' | 'any'

/** 'hero'-typed abilities that accept either team (Regex Substitution swaps with anyone). */
const ANY_TEAM_HERO_ABILITY_IDS: ReadonlySet<string> = new Set(['regex-e'])

/**
 * 'ally' abilities that need ANOTHER allied hero. Reverse Proxy swaps places
 * with the ally (a swap with yourself is a free invulnerability) and Uptime
 * buffs a team-mate ("Buff an allied hero"); the shields, heals and Purge say
 * "or yourself" and keep accepting self.
 */
const ALLY_NOT_SELF_ABILITY_IDS: ReadonlySet<string> = new Set(['proxy-r', 'cron-q'])

/** Does this ability refuse its own caster as the target? */
export function abilityExcludesSelf(ability: AbilityDef): boolean {
  return ALLY_NOT_SELF_ABILITY_IDS.has(ability.id)
}

export function abilityTargetTeam(ability: AbilityDef): AbilityTargetTeam | null {
  if (ability.targetType === 'ally') return 'ally'
  if (ability.targetType === 'hero') {
    return ANY_TEAM_HERO_ABILITY_IDS.has(ability.id) ? 'any' : 'enemy'
  }
  return null
}

/**
 * The one rule for "is this target legal for this ability", shared by the engine
 * (`resolveAbility`, before BW/cooldown are spent) and the client pre-flight
 * (`validateCommand`) so they cannot disagree about it.
 *
 *  - zone-typed abilities (Daemon W/R) need a `zone:<id>` target that exists;
 *    a hero handle is not a place.
 *  - hero / ally abilities must be aimed at the right team (see
 *    {@link abilityTargetTeam}).
 *
 * `lookup` resolves the references against whichever state the caller holds.
 * Heroes it cannot find are left to the caller's own liveness/range messages.
 * Returns the rejection text, or null when the target is acceptable.
 */
export function abilityTargetError(
  ability: AbilityDef,
  casterTeam: TeamId,
  target: TargetRef | undefined,
  lookup: {
    hero: (ref: TargetRef) => { id?: string; name: string; team: TeamId } | undefined
    zoneExists: (zone: string) => boolean
  },
  /** The caster's id — lets a hero handle that names the caster count as self. */
  casterId?: string,
): string | null {
  if (ability.targetType === 'zone') {
    if (!target || target.kind !== 'zone') {
      return `${ability.name} needs a zone target (zone:<id>)`
    }
    if (!lookup.zoneExists(target.zone)) return `${target.zone} is not a zone on this map`
    return null
  }

  const side = abilityTargetTeam(ability)
  if (!side || side === 'any' || !target) return null
  const who = target.kind === 'hero' ? lookup.hero(target) : undefined
  // `self` is on the caster's own team by definition.
  const team = target.kind === 'self' ? casterTeam : who?.team
  if (!team) return null
  const name = target.kind === 'self' ? 'you' : (who?.name ?? 'that hero')
  if (side === 'ally' && team !== casterTeam) {
    return `${name} is an enemy — ${ability.name} targets allies`
  }
  const isSelf = target.kind === 'self' || (!!casterId && who?.id === casterId)
  if (side === 'ally' && isSelf && abilityExcludesSelf(ability)) {
    return `${ability.name} needs another allied hero — not yourself`
  }
  if (side === 'enemy' && team === casterTeam) {
    return target.kind === 'self' || (!!casterId && who?.id === casterId)
      ? `You are on your own team — ${ability.name} targets enemies`
      : `${name} is on your team — ${ability.name} targets enemies`
  }
  return null
}

/**
 * How far from the caster a hero-targeted ability reaches. Everything not listed
 * is `zone` (your own zone only). Mirrors the three resolvers that reach further,
 * so the quick-cast can aim where the engine will accept instead of picking a
 * target the resolver then rejects (a test casts each one to hold this honest).
 *
 *  - `near`     same zone or an adjacent one (Ping ICMP Echo, Malloc Pointer Dereference)
 *  - `adjacent` an adjacent zone only (Socket Accept pulls from next door)
 */
export type AbilityReach = 'zone' | 'near' | 'adjacent'

const ABILITY_REACH: Readonly<Record<string, AbilityReach>> = {
  'ping-q': 'near',
  'malloc-e': 'near',
  'socket-e': 'adjacent',
}

export function abilityReach(ability: AbilityDef): AbilityReach {
  return ABILITY_REACH[ability.id] ?? 'zone'
}
