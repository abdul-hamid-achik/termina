/**
 * Pure helpers for the in-game combat log.
 *
 * These are deliberately store-free so they can be unit-tested in isolation.
 * The Vue component (GameScreen.vue) resolves entity ids to readable labels and
 * the per-event text, then delegates the structural concerns (the readable name
 * for a team's Ancient, and collapsing repeated structure-damage spam) here.
 */

export type CombatLineType =
  | 'damage'
  | 'healing'
  | 'kill'
  | 'gold'
  | 'system'
  | 'ability'
  | 'victory'
  | 'objective'

/**
 * How relevant a line is to the local player — drives visual salience so the
 * fight that matters to ME reads loud and bystander chip dims out:
 *  - mine-in:  damage/effects landing ON me (loudest)
 *  - mine-out: my own actions
 *  - ally:     involves a teammate
 *  - world:    everyone else's chip / neutral events
 */
export type Salience = 'mine-in' | 'mine-out' | 'ally' | 'world'

export interface CombatLine {
  tick: number
  text: string
  type: CombatLineType
  salience?: Salience
  killerHeroId?: string
  victimHeroId?: string
  assisterHeroIds?: string[]
  /** How many ticks of identical structure damage this line represents (>=1). */
  count?: number
  /**
   * When set, consecutive lines sharing this key collapse into one running line.
   * Only structure-damage lines (hero/creep → tower/ancient) set this; combat
   * between heroes, kills, abilities, etc. leave it undefined so they never merge.
   */
  dedupKey?: string
  /** Per-line damage amount, summed into the running total when collapsing. */
  dmgAmount?: number
}

/** Working line with internal bookkeeping used only while collapsing. */
interface RunningLine extends CombatLine {
  total?: number
  baseText?: string
}

/**
 * Resolve a raw target id to the readable name for a team's Ancient ("Core"),
 * or null when the id is not an ancient id. Mirrors the `ancient_<team>` ids
 * produced by AncientSystem.ancientTargetId.
 */
export function ancientLabel(id: string): string | null {
  if (!id.startsWith('ancient_')) return null
  const team = id.slice('ancient_'.length)
  if (team === 'radiant') return 'the Radiant Core'
  if (team === 'dire') return 'the Dire Core'
  return `the ${team} Core`
}

/** True when a damage target id names a structure (tower or ancient). */
export function isStructureTarget(targetId: unknown): boolean {
  return (
    typeof targetId === 'string' &&
    (targetId.startsWith('tower') || targetId.startsWith('ancient_'))
  )
}

/** Title-case a team id for display ("radiant" -> "Radiant"). */
export function teamLabel(team: string): string {
  return team.charAt(0).toUpperCase() + team.slice(1)
}

/**
 * Collapse consecutive structure-damage lines that share a `dedupKey` (same
 * source attacking the same structure) into a single running line instead of
 * one line per tick. The collapsed line keeps the latest tick, accumulates a
 * `count` and a damage `total`, and rewrites its text via `format`.
 *
 * Lines without a `dedupKey` (hero combat, kills, abilities, heals, …) are
 * passed through untouched, and any gap (a different line in between) starts a
 * fresh run — so "Thread hits Core, Thread hits Core, Echo hits Core" collapses
 * the first two and keeps Echo's hit separate.
 */
export function collapseStructureDamage(
  lines: CombatLine[],
  format: (info: { baseText: string; count: number; total: number }) => string,
): CombatLine[] {
  const out: RunningLine[] = []

  for (const line of lines) {
    const prev = out[out.length - 1]
    if (line.dedupKey && prev && prev.dedupKey === line.dedupKey) {
      const count = (prev.count ?? 1) + 1
      const total = (prev.total ?? 0) + (line.dmgAmount ?? 0)
      prev.count = count
      prev.total = total
      prev.tick = line.tick
      prev.text = format({ baseText: prev.baseText ?? prev.text, count, total })
      continue
    }

    if (line.dedupKey) {
      out.push({ ...line, count: 1, total: line.dmgAmount ?? 0, baseText: line.text })
    } else {
      out.push({ ...line })
    }
  }

  // Strip the internal bookkeeping fields before returning.
  return out.map(({ total: _total, baseText: _baseText, ...rest }) => rest)
}
