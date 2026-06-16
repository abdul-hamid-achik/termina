// Shared tactical derivations for the current zone — used by both ZonePanel
// (the detailed unit list) and FocusBanner (the at-a-glance HUD banner) so the
// threat verdict can never drift between the two surfaces.

export type ThreatTone = 'safe' | 'warn' | 'danger'
export type ThreatLabel = 'CLEAR' | 'TOWER' | 'DANGER' | 'CONTESTED' | 'FAVORED'

export interface ZoneThreat {
  label: ThreatLabel
  tone: ThreatTone
}

/**
 * Color-coded threat verdict for the player's current zone.
 * @param enemyCount    enemy heroes present in the zone
 * @param allyHeadcount allied heroes present INCLUDING the local player
 * @param enemyTowerPresent an alive enemy tower is in the zone
 */
export function computeThreat(
  enemyCount: number,
  allyHeadcount: number,
  enemyTowerPresent: boolean,
): ZoneThreat {
  if (enemyCount === 0) {
    if (enemyTowerPresent) return { label: 'TOWER', tone: 'warn' }
    return { label: 'CLEAR', tone: 'safe' }
  }
  if (enemyCount > allyHeadcount) return { label: 'DANGER', tone: 'danger' }
  if (enemyCount === allyHeadcount) return { label: 'CONTESTED', tone: 'warn' }
  return { label: 'FAVORED', tone: 'safe' }
}

/** Tailwind text-color class for a threat tone (matches ZonePanel's mapping). */
export function threatToneClass(tone: ThreatTone): string {
  switch (tone) {
    case 'danger':
      return 'text-dire'
    case 'warn':
      return 'text-gold'
    default:
      return 'text-radiant'
  }
}

export interface RecommendationContext {
  alive: boolean
  /** Current HP as a fraction of max (0..1). */
  hpFraction: number
  threat: ZoneThreat
  /** At least one ability is off cooldown. */
  hasReadyAbility: boolean
}

/**
 * A single "what do I do now" line for the focus banner. Priority order:
 * dead → low HP → the zone's threat verdict. Kept deliberately short so it
 * reads at a glance on a 4-second tick.
 */
export function recommendAction(ctx: RecommendationContext): string {
  if (!ctx.alive) return 'Dead — wait for respawn or buy back'
  if (ctx.hpFraction <= 0.3) return 'Low HP — retreat and heal'
  switch (ctx.threat.label) {
    case 'DANGER':
      return 'Outnumbered — retreat to safety'
    case 'CONTESTED':
      return ctx.hasReadyAbility
        ? 'Even fight — an ability can swing it'
        : 'Even fight — play it safe'
    case 'FAVORED':
      return 'You have the advantage — press it'
    case 'TOWER':
      return 'Enemy tower here — bring creeps before diving'
    case 'CLEAR':
    default:
      return 'Clear — farm, push, or rotate'
  }
}
