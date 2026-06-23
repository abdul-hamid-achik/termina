import type { HeroDef, HeroRole } from '~~/shared/types/hero'
import { heroPlaystyleTags, type PlaystyleTag } from '~~/shared/heroPlaystyle'

export type RoleFilter = 'all' | HeroRole
export type PlaystyleFilter = 'all' | PlaystyleTag

/**
 * Whether a hero passes the /heroes roster filters — role AND playstyle, each
 * with an 'all' pass-through. Two independent axes: role is the hero's lane/job,
 * playstyle is how its kit plays (see heroPlaystyleTags). Pure so the filtering
 * is unit-tested while the page only wires the controls.
 */
export function heroMatchesFilters(
  hero: HeroDef,
  role: RoleFilter,
  playstyle: PlaystyleFilter,
): boolean {
  if (role !== 'all' && hero.role !== role) return false
  if (playstyle !== 'all' && !heroPlaystyleTags(hero).includes(playstyle)) return false
  return true
}

/** Filter a hero list by the active role + playstyle selection. */
export function filterHeroes<T extends HeroDef>(
  heroes: T[],
  role: RoleFilter,
  playstyle: PlaystyleFilter,
): T[] {
  return heroes.filter((h) => heroMatchesFilters(h, role, playstyle))
}
