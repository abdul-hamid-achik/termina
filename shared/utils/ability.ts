import type { AbilityDef, AbilitySlot } from '../types/hero'
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
