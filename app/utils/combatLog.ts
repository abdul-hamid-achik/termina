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
  // One dim roll-up line per tick summarizing everyone's farming (see
  // digestFarmNoise) — the story-mode replacement for the creep-hit firehose.
  | 'farm'

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
  /**
   * Farm-noise tag: what kind of farming beat this line narrates. Story mode
   * (digestFarmNoise) folds all tagged lines of a tick into one dim summary
   * line; verbose mode shows them raw. Untagged lines are never folded.
   */
  farmKind?: 'hit' | 'lasthit' | 'camp' | 'deny'
  /** Gold carried by a folded farm line (my last-hit reward in the summary). */
  goldAmount?: number
}

/** Working line with internal bookkeeping used only while collapsing. */
interface RunningLine extends CombatLine {
  total?: number
  baseText?: string
}

/**
 * Resolve a raw target id to the readable name for a team's win structure —
 * the "Mainframe" in Termina's terminal world — or null when the id is not an
 * ancient id. Mirrors the `ancient_<team>` ids produced by
 * AncientSystem.ancientTargetId (the internal name stays "ancient").
 */
export function ancientLabel(id: string): string | null {
  if (!id.startsWith('ancient_')) return null
  const team = id.slice('ancient_'.length)
  if (team === 'radiant') return 'the Radiant Mainframe'
  if (team === 'dire') return 'the Dire Mainframe'
  return `the ${team} Mainframe`
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

// ── Tick story (feed default view) ──────────────────────────────

/** Salience → beat position. Your lines lead, headline plays follow, the
 *  world's business trails, the farm digest closes the beat. */
function storyPriority(line: CombatLine): number {
  if (line.type === 'farm') return 9
  if (line.salience === 'mine-in') return 0
  if (line.salience === 'mine-out') return 1
  if (line.type === 'kill' || line.type === 'victory') return 2
  if (line.type === 'objective') return 3
  if (line.salience === 'ally') return 4
  if (line.type === 'system') return 6
  return 5
}

/**
 * Fold every farm-tagged line of a tick into ONE dim summary line:
 * "· farm: you +38g (last-hit) · team 4 creeps, 1 camp · enemy farming in sight".
 * Untagged lines pass through untouched, in their original tick order.
 */
export function digestFarmNoise(lines: CombatLine[]): CombatLine[] {
  const out: CombatLine[] = []
  let tick: number | null = null
  let bucket: CombatLine[] = []

  const flush = () => {
    if (tick === null || bucket.length === 0) return
    let myGold = 0
    let myLastHits = 0
    let myCamps = 0
    let myDenies = 0
    let teamLastHits = 0
    let teamCamps = 0
    let teamDenies = 0
    let enemyLastHits = 0
    let enemyCamps = 0
    let enemyDenies = 0
    let enemyHitsSeen = false
    for (const l of bucket) {
      // Three-way attribution: mine / team (ally) / enemy (world) — visible
      // enemy camp clears and denies must not be counted as "team".
      const side = l.salience === 'mine-out' ? 'mine' : l.salience === 'world' ? 'enemy' : 'team'
      if (l.farmKind === 'lasthit') {
        if (side === 'mine') {
          myLastHits++
          myGold += l.goldAmount ?? 0
        } else if (side === 'enemy') enemyLastHits++
        else teamLastHits++
      } else if (l.farmKind === 'camp') {
        if (side === 'mine') myCamps++
        else if (side === 'enemy') enemyCamps++
        else teamCamps++
      } else if (l.farmKind === 'deny') {
        if (side === 'mine') myDenies++
        else if (side === 'enemy') enemyDenies++
        else teamDenies++
      } else if (l.farmKind === 'hit') {
        if (side === 'enemy') enemyHitsSeen = true
      }
    }
    const parts: string[] = []
    if (myLastHits > 0)
      parts.push(`you +${myGold}g (${myLastHits} last-hit${myLastHits === 1 ? '' : 's'})`)
    if (myCamps > 0) parts.push(`you cleared ${myCamps === 1 ? 'a camp' : `${myCamps} camps`}`)
    if (myDenies > 0) parts.push(`you denied ${myDenies === 1 ? 'a creep' : `${myDenies} creeps`}`)
    const teamBits: string[] = []
    if (teamLastHits > 0) teamBits.push(`${teamLastHits} creep${teamLastHits === 1 ? '' : 's'}`)
    if (teamCamps > 0) teamBits.push(`${teamCamps} camp${teamCamps === 1 ? '' : 's'}`)
    if (teamDenies > 0) teamBits.push(`${teamDenies} den${teamDenies === 1 ? 'y' : 'ies'}`)
    if (teamBits.length) parts.push(`team ${teamBits.join(', ')}`)
    const enemyBits: string[] = []
    if (enemyLastHits > 0) enemyBits.push(`${enemyLastHits} creep${enemyLastHits === 1 ? '' : 's'}`)
    if (enemyCamps > 0) enemyBits.push(`${enemyCamps} camp${enemyCamps === 1 ? '' : 's'}`)
    if (enemyDenies > 0) enemyBits.push(`${enemyDenies} den${enemyDenies === 1 ? 'y' : 'ies'}`)
    if (enemyBits.length) parts.push(`enemy ${enemyBits.join(', ')}`)
    else if (enemyHitsSeen) parts.push('enemy farming in sight')
    if (parts.length) {
      // The digest carrying MY rewards is mine — the ME filter must keep it.
      const hasMine = myLastHits > 0 || myCamps > 0 || myDenies > 0
      out.push({
        tick,
        text: `farm: ${parts.join(' · ')}`,
        type: 'farm',
        salience: hasMine ? 'mine-out' : 'world',
      })
    }
    bucket = []
  }

  for (const line of lines) {
    if (line.tick !== tick) {
      flush()
      tick = line.tick
    }
    if (line.farmKind) bucket.push(line)
    else out.push(line)
  }
  flush()
  return out
}

/**
 * The feed's default ("story") view: farm noise folded to one line per tick,
 * then each tick's lines ordered by salience — YOUR results first, kills and
 * objectives loud, the farm digest last. Stable within a priority band.
 */
export function buildTickStoryView(lines: CombatLine[]): CombatLine[] {
  const digested = digestFarmNoise(lines)
  // Stable sort per tick: decorate with the original index, sort, strip.
  return digested
    .map((line, i) => ({ line, i }))
    .sort((a, b) => {
      if (a.line.tick !== b.line.tick) return a.line.tick - b.line.tick
      const pa = storyPriority(a.line)
      const pb = storyPriority(b.line)
      return pa !== pb ? pa - pb : a.i - b.i
    })
    .map(({ line }) => line)
}
