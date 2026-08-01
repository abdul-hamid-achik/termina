import type { HeroDef, HeroPosture } from '~~/shared/types/hero'
import { heroPlaystyleTags, type PlaystyleTag } from '~~/shared/heroPlaystyle'

export type PostureFilter = 'all' | HeroPosture
export type PlaystyleFilter = 'all' | PlaystyleTag

/**
 * Whether a hero passes the /cast roster filters — posture AND playstyle,
 * each with an 'all' pass-through. Two independent axes: posture is what a
 * player picks on (B2a), playstyle is how its kit plays (heroPlaystyleTags).
 * Pure so the filtering is unit-tested while the page only wires the controls.
 */
export function heroMatchesFilters(
  hero: HeroDef,
  posture: PostureFilter,
  playstyle: PlaystyleFilter,
): boolean {
  if (posture !== 'all' && hero.posture !== posture) return false
  if (playstyle !== 'all' && !heroPlaystyleTags(hero).includes(playstyle)) return false
  return true
}

/** Filter a hero list by the active posture + playstyle selection. */
export function filterHeroes<T extends HeroDef>(
  heroes: T[],
  posture: PostureFilter,
  playstyle: PlaystyleFilter,
): T[] {
  return heroes.filter((h) => heroMatchesFilters(h, posture, playstyle))
}
