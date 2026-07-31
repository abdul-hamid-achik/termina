/**
 * Pure helpers for the in-game combat log.
 *
 * These are deliberately store-free so they can be unit-tested in isolation.
 * The Vue component (GameScreen.vue) resolves entity ids to readable labels and
 * the per-event text, then delegates the structural concerns (the readable name
 * for a team's Terminal, and collapsing repeated structure-damage spam) here.
 */

import { FACTION_META } from '~~/shared/constants/world'
import type { TeamId } from '~~/shared/types/game'

export type CombatLineType =
  | 'damage'
  | 'healing'
  | 'kill'
  | 'scrip'
  | 'system'
  | 'ability'
  | 'victory'
  | 'objective'
  // One dim roll-up line per cycle summarizing everyone's farming (see
  // digestFarmNoise) — the story-mode replacement for the wave-hit firehose.
  | 'farm'
  // The rig's voice: the tactical recommendation FocusBanner used to pin above
  // the grid, now a `> ` line in the scrollback (R3-06).
  | 'rig'

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
  cycle: number
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
   * Only structure-damage lines (hero/wave → ice/terminal) set this; combat
   * between heroes, kills, abilities, etc. leave it undefined so they never merge.
   */
  dedupKey?: string
  /** Damage this line represents. On a collapsed run it is the run's total, so
   *  the per-cycle recap never has to re-derive it from the rendered text. */
  dmgAmount?: number
  /** Who dealt / who received the damage, as already-resolved display labels.
   *  The recap groups by these; parsing them back out of `text` would break the
   *  moment any narration wording changes. */
  sourceLabel?: string
  targetLabel?: string
  /**
   * Farm-noise tag: what kind of farming beat this line narrates. Story mode
   * (digestFarmNoise) folds all tagged lines of a cycle into one dim summary
   * line; verbose mode shows them raw. Untagged lines are never folded.
   */
  farmKind?: 'hit' | 'lasthit' | 'camp' | 'burn'
  /** Gold carried by a folded farm line (my last-hit reward in the summary). */
  scripAmount?: number
}

/** Working line with internal bookkeeping used only while collapsing. */
interface RunningLine extends CombatLine {
  total?: number
  baseText?: string
}

/**
 * Resolve a raw target id to the readable name for a team's win structure —
 * the "Terminal" in Termina's terminal world — or null when the id is not
 * a terminal id. Mirrors the `terminal_<team>` ids produced by
 * TerminalSystem.terminalTargetId.
 */
export function terminalLabel(id: string): string | null {
  if (!id.startsWith('terminal_')) return null
  const team = id.slice('terminal_'.length)
  if (team === 'chaff' || team === 'audit') {
    return `the ${FACTION_META[team as TeamId].label} Terminal`
  }
  return `the ${team} Terminal`
}

/** True when a damage target id names a structure (ice or terminal). */
export function isStructureTarget(targetId: unknown): boolean {
  return (
    typeof targetId === 'string' && (targetId.startsWith('ice') || targetId.startsWith('terminal_'))
  )
}

/** Faction display label from the world lexicon ("chaff" -> "CHAFF"). */
export function teamLabel(team: string): string {
  return FACTION_META[team as TeamId]?.label ?? team.toUpperCase()
}

/**
 * Collapse consecutive structure-damage lines that share a `dedupKey` (same
 * source attacking the same structure) into a single running line instead of
 * one line per cycle. The collapsed line keeps the latest cycle, accumulates a
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
      // The surviving line now stands for the whole run, so its amount must be
      // the run total — otherwise the cycle recap counts only the first hit.
      prev.dmgAmount = total
      prev.cycle = line.cycle
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
 * Fold every farm-tagged line of a cycle into ONE dim summary line:
 * "· farm: you +38g (last-hit) · team 4 waves, 1 camp · enemy farming in sight".
 * Untagged lines pass through untouched, in their original cycle order.
 */
export function digestFarmNoise(lines: CombatLine[]): CombatLine[] {
  const out: CombatLine[] = []
  let cycle: number | null = null
  let bucket: CombatLine[] = []

  const flush = () => {
    if (cycle === null || bucket.length === 0) return
    let myGold = 0
    let myLastHits = 0
    let myCamps = 0
    let myBurns = 0
    let teamLastHits = 0
    let teamCamps = 0
    let teamBurns = 0
    let enemyLastHits = 0
    let enemyCamps = 0
    let enemyBurns = 0
    let enemyHitsSeen = false
    for (const l of bucket) {
      // Three-way attribution: mine / team (ally) / enemy (world) — visible
      // enemy camp clears and burns must not be counted as "team".
      const side = l.salience === 'mine-out' ? 'mine' : l.salience === 'world' ? 'enemy' : 'team'
      if (l.farmKind === 'lasthit') {
        if (side === 'mine') {
          myLastHits++
          myGold += l.scripAmount ?? 0
        } else if (side === 'enemy') enemyLastHits++
        else teamLastHits++
      } else if (l.farmKind === 'camp') {
        if (side === 'mine') myCamps++
        else if (side === 'enemy') enemyCamps++
        else teamCamps++
      } else if (l.farmKind === 'burn') {
        if (side === 'mine') myBurns++
        else if (side === 'enemy') enemyBurns++
        else teamBurns++
      } else if (l.farmKind === 'hit') {
        if (side === 'enemy') enemyHitsSeen = true
      }
    }
    const parts: string[] = []
    if (myLastHits > 0)
      parts.push(`you +${myGold}sc (${myLastHits} last-hit${myLastHits === 1 ? '' : 's'})`)
    if (myCamps > 0) parts.push(`you cleared ${myCamps === 1 ? 'a camp' : `${myCamps} camps`}`)
    if (myBurns > 0) parts.push(`you burned ${myBurns === 1 ? 'a wave' : `${myBurns} waves`}`)
    const teamBits: string[] = []
    if (teamLastHits > 0) teamBits.push(`${teamLastHits} wave${teamLastHits === 1 ? '' : 's'}`)
    if (teamCamps > 0) teamBits.push(`${teamCamps} camp${teamCamps === 1 ? '' : 's'}`)
    if (teamBurns > 0) teamBits.push(`${teamBurns} burn${teamBurns === 1 ? '' : 's'}`)
    if (teamBits.length) parts.push(`team ${teamBits.join(', ')}`)
    const enemyBits: string[] = []
    if (enemyLastHits > 0) enemyBits.push(`${enemyLastHits} wave${enemyLastHits === 1 ? '' : 's'}`)
    if (enemyCamps > 0) enemyBits.push(`${enemyCamps} camp${enemyCamps === 1 ? '' : 's'}`)
    if (enemyBurns > 0) enemyBits.push(`${enemyBurns} burn${enemyBurns === 1 ? '' : 's'}`)
    if (enemyBits.length) parts.push(`enemy ${enemyBits.join(', ')}`)
    else if (enemyHitsSeen) parts.push('enemy farming in sight')
    if (parts.length) {
      // The digest carrying MY rewards is mine — the ME filter must keep it.
      const hasMine = myLastHits > 0 || myCamps > 0 || myBurns > 0
      out.push({
        cycle,
        text: `farm: ${parts.join(' · ')}`,
        type: 'farm',
        salience: hasMine ? 'mine-out' : 'world',
      })
    }
    bucket = []
  }

  for (const line of lines) {
    if (line.cycle !== cycle) {
      flush()
      cycle = line.cycle
    }
    if (line.farmKind) bucket.push(line)
    else out.push(line)
  }
  flush()
  return out
}

/**
 * Fold a run of bystander hero-vs-hero damage into ONE summary line when a
 * teamfight produces many "world" damage lines at once — the teamfight analogue
 * of digestFarmNoise. Lines involving ME or an ally, kills, abilities, etc. are
 * never folded; only the chip-damage firehose between OTHER heroes collapses, so
 * a 10-hero clash reads as one "⚔ teamfight" beat instead of ~18 lines. Applied
 * after the story sort, where a tick's world-damage lines sit contiguous.
 */
export function digestTeamfightNoise(lines: CombatLine[], threshold = 4): CombatLine[] {
  const out: CombatLine[] = []
  let bucket: CombatLine[] = []

  const flush = () => {
    if (bucket.length === 0) return
    if (bucket.length > threshold) {
      const cycle = bucket[0]!.cycle
      const total = bucket.reduce((s, l) => s + (l.dmgAmount ?? 0), 0)
      out.push({
        cycle,
        text: `⚔ teamfight: ${bucket.length} hits trading${total > 0 ? ` (${total} dmg)` : ''}`,
        type: 'damage',
        salience: 'world',
      })
    } else {
      out.push(...bucket)
    }
    bucket = []
  }

  for (const line of lines) {
    if (line.type === 'damage' && line.salience === 'world' && !line.dedupKey) {
      bucket.push(line)
    } else {
      flush()
      out.push(line)
    }
  }
  flush()
  return out
}

/**
 * The feed's default ("story") view: farm noise folded to one line per cycle,
 * then each cycle's lines ordered by salience — YOUR results first, kills and
 * objectives loud, the farm digest last. Stable within a priority band.
 */
export function buildTickStoryView(lines: CombatLine[]): CombatLine[] {
  const digested = digestFarmNoise(lines)
  // Stable sort per cycle: decorate with the original index, sort, strip.
  const sorted = digested
    .map((line, i) => ({ line, i }))
    .sort((a, b) => {
      if (a.line.cycle !== b.line.cycle) return a.line.cycle - b.line.cycle
      const pa = storyPriority(a.line)
      const pb = storyPriority(b.line)
      return pa !== pb ? pa - pb : a.i - b.i
    })
    .map(({ line }) => line)
  // Fold bystander teamfight damage now that it sits contiguous per cycle.
  return digestTeamfightNoise(sorted)
}

// ── Per-cycle personal recap ────────────────────────────────────

/** One tick's damage ledger for the local player. */
export interface TickRecap {
  cycle: number
  /** Damage that landed on the local player this cycle. */
  taken: number
  /** Damage the local player dealt this cycle. */
  dealt: number
  /** "You took 131 (Mutex 106, burn 25)", or null when nothing landed. */
  takenText: string | null
  /** "You dealt 62 to Thread", or null when the player dealt nothing. */
  dealtText: string | null
  /** Both clauses joined — the screen-reader / test-facing rendering. */
  text: string
}

/** Contributors listed by name before the rest roll up into "+N more". */
const RECAP_BREAKDOWN_LIMIT = 3

/**
 * "You took 131 (Mutex 106, burn 25)". A lone contributor reads better named
 * inline ("You took 106 from Mutex") than as a one-item parenthetical.
 */
function recapClause(
  lead: string,
  total: number,
  by: Map<string, number>,
  preposition: string,
): string {
  const entries = [...by.entries()].sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return `${lead} ${total}`
  if (entries.length === 1) return `${lead} ${total} ${preposition} ${entries[0]![0]}`
  const shown = entries.slice(0, RECAP_BREAKDOWN_LIMIT).map(([label, n]) => `${label} ${n}`)
  const rest = entries.length - shown.length
  if (rest > 0) shown.push(`+${rest} more`)
  return `${lead} ${total} (${shown.join(', ')})`
}

function bump(by: Map<string, number>, label: string, amount: number) {
  by.set(label, (by.get(label) ?? 0) + amount)
}

/**
 * Reduce a line stream to one damage ledger per cycle, so a 4-second turn can be
 * read as a single sentence instead of mentally summing six chip lines.
 *
 * Deliberately built from the RAW line list rather than the story view: the
 * filter chips and the 120-line render cap must not change what the recap says
 * happened to you.
 */
export function buildTickRecaps(lines: CombatLine[]): Map<number, TickRecap> {
  const takenBy = new Map<number, Map<string, number>>()
  const dealtTo = new Map<number, Map<string, number>>()

  for (const line of lines) {
    if (line.type !== 'damage') continue
    const amount = line.dmgAmount ?? 0
    if (amount <= 0) continue
    if (line.salience === 'mine-in') {
      const by = takenBy.get(line.cycle) ?? new Map<string, number>()
      bump(by, line.sourceLabel || 'unknown', amount)
      takenBy.set(line.cycle, by)
    } else if (line.salience === 'mine-out') {
      const by = dealtTo.get(line.cycle) ?? new Map<string, number>()
      bump(by, line.targetLabel || 'unknown', amount)
      dealtTo.set(line.cycle, by)
    }
  }

  const out = new Map<number, TickRecap>()
  for (const cycle of new Set([...takenBy.keys(), ...dealtTo.keys()])) {
    const inBy = takenBy.get(cycle)
    const outBy = dealtTo.get(cycle)
    const taken = inBy ? [...inBy.values()].reduce((s, n) => s + n, 0) : 0
    const dealt = outBy ? [...outBy.values()].reduce((s, n) => s + n, 0) : 0
    const takenText = inBy ? recapClause('You took', taken, inBy, 'from') : null
    const dealtText = outBy ? recapClause('You dealt', dealt, outBy, 'to') : null
    out.set(cycle, {
      cycle,
      taken,
      dealt,
      takenText,
      dealtText,
      text: [takenText, dealtText].filter(Boolean).join(' · '),
    })
  }
  return out
}
