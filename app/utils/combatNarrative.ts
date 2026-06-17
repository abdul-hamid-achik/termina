/**
 * Combat narrative — turns the raw engine event stream into the in-game combat
 * log's lines and the cinematic kill feed.
 *
 * Two responsibilities, both pure (store-free, unit-tested):
 *  1. `buildCombatLines` — map ALL ~33 event types to readable, salience-tagged
 *     lines (today most fall through to raw JSON). Entity/ability/item ids are
 *     resolved by the caller via a `NarrativeContext` so this stays store-free.
 *  2. `deriveKillFeed` — replay the kill/objective stream to derive first-blood,
 *     multi-kill, shutdown, and kill-streak headlines for the kill-feed banner.
 *
 * The voice leans lightly into the process/terminal fiction the heroes already
 * imply (null_ref, cache, thread…): a kill is a SIGKILL/termination, the enemy
 * Core falling is a "core dumped". Kept parseable — not obfuscated.
 */
import type { GameEvent } from '~~/shared/types/game'
import { isStructureTarget, teamLabel, type CombatLine, type Salience } from './combatLog'

export interface NarrativeContext {
  /** The local player's id (for salience). */
  playerId: string | null
  /** The local player's team (for ally salience). */
  myTeam?: string
  /** Resolve any entity id to a readable label ("You", hero name, "a creep"…). */
  entityLabel: (id: unknown) => string
  /** Resolve an ability id to its display name. */
  abilityLabel: (id: unknown) => string
  /** The team of an entity id, when known (for ally salience). */
  teamOf: (id: unknown) => string | undefined
  /** Hero id for a player id, when known (for inline avatars). */
  heroIdOf: (id: unknown) => string | undefined
  /** Item display name for an item id. */
  itemName: (id: string) => string
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A kill streak of 3+ earns a named spree (mirrors the in-game shutdown bounty). */
const SPREE_LABELS: Record<number, string> = {
  3: 'KILLING SPREE',
  4: 'DOMINATING',
  5: 'MEGA KILL',
  6: 'UNSTOPPABLE',
  7: 'GODLIKE',
}

/**
 * The dramatic suffix on a kill line. Ending a fed enemy's run is the SHUTDOWN
 * beat (and pairs with the streak-scaled bounty); otherwise a killer on a 3+
 * run gets a named spree. Empty for ordinary kills.
 */
function killFlair(victimStreak: number, killerStreak: number): string {
  if (victimStreak >= 3) return `  >> SHUTDOWN! (ended a ${victimStreak}-kill streak)`
  if (killerStreak >= 3) {
    const label =
      killerStreak >= 8 ? 'BEYOND GODLIKE' : (SPREE_LABELS[killerStreak] ?? 'KILLING SPREE')
    return `  >> ${label} (${killerStreak})`
  }
  return ''
}

/** Salience of a source→target interaction relative to the local player. */
function salience(sourceId: unknown, targetId: unknown, ctx: NarrativeContext): Salience {
  const me = ctx.playerId
  if (me && targetId === me) return 'mine-in'
  if (me && sourceId === me) return 'mine-out'
  if (ctx.myTeam) {
    if (ctx.teamOf(sourceId) === ctx.myTeam || ctx.teamOf(targetId) === ctx.myTeam) return 'ally'
  }
  return 'world'
}

/** Salience of a single-actor event (level up, last hit, …). */
function actorSalience(playerId: unknown, ctx: NarrativeContext): Salience {
  const me = ctx.playerId
  if (me && playerId === me) return 'mine-out'
  if (ctx.myTeam && ctx.teamOf(playerId) === ctx.myTeam) return 'ally'
  return 'world'
}

/** Gold-change reasons already narrated by a dedicated line — suppressed as noise. */
const REDUNDANT_GOLD = /creep|last.?hit|deny|passive|neutral/i

/**
 * Map a single engine event to a combat-log line, or `null` to suppress it
 * (internal/spammy events). The giant switch that used to live in
 * GameScreen.vue now lives here, covering every event type.
 */
export function eventToLine(e: GameEvent, ctx: NarrativeContext): CombatLine | null {
  const p = e.payload
  const tick = e.tick
  const label = ctx.entityLabel.bind(ctx)

  switch (e.type) {
    case 'damage': {
      const dtype = str(p.damageType)
      const line: CombatLine = {
        tick,
        text: `${label(p.sourceId)} hit ${label(p.targetId)} for ${num(p.amount)}${dtype ? ` ${dtype}` : ''}`,
        type: 'damage',
        salience: salience(p.sourceId, p.targetId, ctx),
      }
      // Repeated chip on a tower/Core collapses into one running line.
      if (isStructureTarget(p.targetId)) {
        line.dedupKey = `dmg:${str(p.sourceId)}->${str(p.targetId)}`
        line.dmgAmount = num(p.amount)
      }
      return line
    }

    case 'heal':
      return {
        tick,
        text: `${label(p.sourceId)} restored ${num(p.amount)} to ${label(p.targetId)}`,
        type: 'healing',
        salience: salience(p.sourceId, p.targetId, ctx),
      }

    case 'kill': {
      const assisters = Array.isArray(p.assisters) ? (p.assisters as string[]) : []
      const assistText = assisters.length
        ? `  assist: ${assisters.map((a) => label(a)).join(', ')}`
        : ''
      const flair = killFlair(num(p.victimStreak), num(p.killerStreak))
      return {
        tick,
        text: `${label(p.killerId)} terminated ${label(p.victimId)}${flair}${assistText}`,
        type: 'kill',
        salience: salience(p.killerId, p.victimId, ctx),
        killerHeroId: ctx.heroIdOf(p.killerId),
        victimHeroId: ctx.heroIdOf(p.victimId),
        assisterHeroIds: assisters.map((a) => ctx.heroIdOf(a)).filter((h): h is string => !!h),
      }
    }

    case 'death': {
      const respawn =
        p.respawnTick != null ? ` — respawn ${Math.max(0, num(p.respawnTick) - tick)}t` : ''
      return {
        tick,
        text: `${label(p.playerId)} was terminated${respawn}`,
        type: 'damage',
        salience: actorSalience(p.playerId, ctx),
      }
    }

    case 'tower_kill':
      return {
        tick,
        text: `${teamLabel(str(p.killerTeam))} razed the ${teamLabel(str(p.team))} tower in ${str(p.zone)}`,
        type: 'kill',
        salience: ctx.myTeam === str(p.killerTeam) ? 'mine-out' : 'mine-in',
      }

    case 'ancient_destroyed':
      // Keep the exact "destroyed the … Core!" phrasing the victory line expects.
      return {
        tick,
        text: `${teamLabel(str(p.killerTeam))} destroyed the ${teamLabel(str(p.team))} Core!`,
        type: 'victory',
      }

    case 'creep_lasthit':
      return {
        tick,
        text: `${label(p.playerId)} last-hit a ${str(p.creepType)} creep (+${num(p.goldAwarded)}g)`,
        type: 'gold',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'creep_deny':
      return {
        tick,
        text: `${label(p.playerId)} denied a ${str(p.creepType)} creep`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'gold_change': {
      const reason = str(p.reason)
      // Drop gold lines a dedicated line already narrates (last-hits, denies,
      // passive trickle) — the dominant source of farming-phase noise.
      if (REDUNDANT_GOLD.test(reason)) return null
      const amt = num(p.amount)
      return {
        tick,
        text: `${label(p.playerId)} ${amt >= 0 ? 'earned' : 'lost'} ${Math.abs(amt)}g (${reason})`,
        type: 'gold',
        salience: actorSalience(p.playerId, ctx),
      }
    }

    case 'level_up':
      return {
        tick,
        text: `${label(p.playerId)} reached level ${num(p.newLevel)}`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'ability_used':
      return {
        tick,
        text: `${label(p.playerId)} cast ${ctx.abilityLabel(p.abilityId)}${p.targetId ? ` on ${label(p.targetId)}` : ''}`,
        type: 'ability',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'power_spike':
      // The engine already writes human prose here — surface it instead of JSON.
      return {
        tick,
        text: str(p.message) || `${label(p.playerId)} hit a power spike`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'enemy_missing':
      return {
        tick,
        text: `[MISSING] ${label(p.playerId)} — last seen ${str(p.lastSeenZone)}`,
        type: 'system',
        salience: 'ally',
      }

    case 'item_purchased':
      return {
        tick,
        text: `${label(p.playerId)} acquired ${ctx.itemName(str(p.itemId))} (-${num(p.cost)}g)`,
        type: 'gold',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'item_sold':
      return {
        tick,
        text: `${label(p.playerId)} sold ${ctx.itemName(str(p.itemId))} (+${num(p.refund)}g)`,
        type: 'gold',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'ward_placed':
      return {
        tick,
        text: `${label(p.playerId)} planted a ${str(p.wardType)} ward in ${str(p.zone)}`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'rune_picked':
      return {
        tick,
        text: `${label(p.playerId)} grabbed the ${str(p.runeType)} rune`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'roshan_killed':
      // Two events share this tag: the public one carries killerTeam+gold.
      return p.killerTeam
        ? {
            tick,
            text: `${teamLabel(str(p.killerTeam))} slew Roshan (+${num(p.goldAwarded)}g)`,
            type: 'objective',
          }
        : { tick, text: `Roshan has fallen`, type: 'objective' }

    case 'roshan_respawn':
      return { tick, text: `Roshan has respawned`, type: 'objective' }

    case 'roshan_damage':
      // Chip on Roshan repeats every tick — collapse like structure damage.
      return {
        tick,
        text: `Roshan takes ${num(p.damage)} (${num(p.hp)}/${num(p.maxHp)})`,
        type: 'damage',
        salience: 'world',
        dedupKey: 'dmg:roshan',
        dmgAmount: num(p.damage),
      }

    case 'neutral_killed':
      return {
        tick,
        text: `${label(p.playerId)} cleared a ${str(p.neutralType)} camp`,
        type: 'gold',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'aegis_picked':
      return {
        tick,
        text: `${label(p.playerId)} claimed the Aegis`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'aegis_used':
      return {
        tick,
        text: `${label(p.playerId)} reincarnated via the Aegis`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'talent_selected':
      return {
        tick,
        text: `${label(p.playerId)} learned ${str(p.talentName)}`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'teleport_complete':
      return {
        tick,
        text:
          p.source === 'next_hop'
            ? `${label(p.playerId)}'s return shadow snapped them back to ${str(p.destination)}`
            : `${label(p.playerId)} teleported to ${str(p.destination)}`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'trap_triggered':
      return {
        tick,
        text: `${label(p.owner)}'s trap caught ${label(p.targetId)} in ${str(p.zone)} (-${num(p.damage)})`,
        type: 'damage',
        salience: salience(p.owner, p.targetId, ctx),
      }

    case 'spell_blocked': {
      const text =
        p.source === 'lotus_orb'
          ? `${label(p.targetId)}'s Lotus Orb reflected ${label(p.casterId)}'s spell${p.reflected ? ` (-${num(p.reflected)})` : ''}`
          : `${label(p.targetId)}'s ${p.source === 'linkens_sphere' ? "Linken's Sphere" : 'Firewall'} blocked ${label(p.casterId)}'s spell`
      return {
        tick,
        text,
        type: 'system',
        salience: salience(p.casterId, p.targetId, ctx),
      }
    }

    case 'teleport_cancelled':
      return {
        tick,
        text: `${label(p.playerId)}'s teleport was cancelled (${str(p.reason)})`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'night_falls':
      return { tick, text: `— NIGHT FALLS · vision reduced —`, type: 'objective' }

    case 'day_breaks':
      return { tick, text: `— DAY BREAKS · full vision —`, type: 'objective' }

    case 'glyph_used':
      return {
        tick,
        text: `${teamLabel(str(p.team))} activated the Glyph`,
        type: 'system',
        salience: ctx.myTeam === str(p.team) ? 'ally' : 'world',
      }

    case 'surrender_vote':
      return {
        tick,
        text: `${teamLabel(str(p.team))} surrender vote: ${num(p.votesFor)}/${num(p.votesNeeded)}`,
        type: 'system',
        salience: ctx.myTeam === str(p.team) ? 'ally' : 'world',
      }

    case 'surrendered':
      return {
        tick,
        text: `${teamLabel(str(p.team))} surrendered — ${teamLabel(str(p.winner))} wins!`,
        type: 'victory',
      }

    // Internal / non-narrative events — intentionally produce no line.
    case 'cooldown_used':
    case 'contest_lasthit':
    case 'glyph_on_cooldown':
    case 'tower_invulnerable':
      return null

    default:
      return null
  }
}

/**
 * Build the full line list from an event stream: map each event, drop the
 * suppressed ones, then collapse repeated structure/Roshan chip.
 */
export function buildCombatLines(
  events: GameEvent[],
  ctx: NarrativeContext,
  collapse: (
    lines: CombatLine[],
    format: (info: { baseText: string; count: number; total: number }) => string,
  ) => CombatLine[],
): CombatLine[] {
  const mapped: CombatLine[] = []
  for (const e of events) {
    const line = eventToLine(e, ctx)
    if (line) mapped.push(line)
  }
  return collapse(mapped, ({ baseText, count, total }) => `${baseText} ×${count} (${total} total)`)
}

// ── Kill feed ───────────────────────────────────────────────────────

export type KillCategory = 'hero' | 'tower' | 'roshan' | 'core'

export interface KillFeedEntry {
  tick: number
  category: KillCategory
  killerId?: string
  victimId?: string
  killerHeroId?: string
  victimHeroId?: string
  assisters: string[]
  /** First hero kill of the match. */
  firstBlood?: boolean
  /** Victim was on a streak (>=3) — bonus "SHUTDOWN". */
  shutdown?: boolean
  /** 2+ when the killer chained kills within the multi-kill window. */
  multiKill?: number
  /** Killer's ongoing streak after this kill. */
  streak?: number
  /** Pre-rendered headline text. */
  text: string
}

/** Consecutive kills within this many ticks chain into a multi-kill. */
const MULTI_KILL_WINDOW = 4
/** Victim streak at/above this becomes a shutdown. */
const SHUTDOWN_STREAK = 3

const MULTI_LABEL: Record<number, string> = {
  2: 'DOUBLE KILL',
  3: 'TRIPLE KILL',
  4: 'ULTRA KILL',
  5: 'RAMPAGE',
}

const STREAK_LABEL: Record<number, string> = {
  3: 'KILLING SPREE',
  4: 'DOMINATING',
  5: 'MEGA KILL',
  6: 'UNSTOPPABLE',
  7: 'WICKED SICK',
  8: 'MONSTER KILL',
  9: 'GODLIKE',
}

/**
 * Replay the event stream to derive kill-feed headlines: first blood, multi-
 * kills, shutdowns, and ongoing streaks for hero kills, plus tower/roshan/core
 * headline events. Pure — no store access.
 */
export function deriveKillFeed(events: GameEvent[], ctx: NarrativeContext): KillFeedEntry[] {
  const streaks = new Map<string, number>()
  const lastKillTick = new Map<string, number>()
  const multiCount = new Map<string, number>()
  let firstBloodDone = false
  const out: KillFeedEntry[] = []

  const ordered = [...events].sort((a, b) => a.tick - b.tick)

  for (const e of ordered) {
    const p = e.payload
    if (e.type === 'death') {
      // A death not already booked by a kill still ends that player's streak.
      streaks.set(str(p.playerId), 0)
      continue
    }

    if (e.type === 'kill') {
      const killerId = str(p.killerId)
      const victimId = str(p.victimId)
      const assisters = Array.isArray(p.assisters) ? (p.assisters as string[]) : []

      const victimStreakBefore = streaks.get(victimId) ?? 0
      const streak = (streaks.get(killerId) ?? 0) + 1
      streaks.set(killerId, streak)
      streaks.set(victimId, 0)

      const lt = lastKillTick.get(killerId)
      const multi =
        lt != null && e.tick - lt <= MULTI_KILL_WINDOW ? (multiCount.get(killerId) ?? 1) + 1 : 1
      multiCount.set(killerId, multi)
      lastKillTick.set(killerId, e.tick)

      const firstBlood = !firstBloodDone
      firstBloodDone = true
      const shutdown = victimStreakBefore >= SHUTDOWN_STREAK

      out.push({
        tick: e.tick,
        category: 'hero',
        killerId,
        victimId,
        killerHeroId: ctx.heroIdOf(killerId),
        victimHeroId: ctx.heroIdOf(victimId),
        assisters,
        firstBlood,
        shutdown,
        multiKill: multi >= 2 ? multi : undefined,
        streak,
        text: killHeadlineText({ killerId, victimId, firstBlood, shutdown, multi, streak }, ctx),
      })
      continue
    }

    if (e.type === 'ancient_destroyed') {
      out.push({
        tick: e.tick,
        category: 'core',
        assisters: [],
        text: `${teamLabel(str(p.killerTeam))} CORE DUMPED the ${teamLabel(str(p.team))} Core`,
      })
      continue
    }

    if (e.type === 'roshan_killed' && p.killerTeam) {
      out.push({
        tick: e.tick,
        category: 'roshan',
        assisters: [],
        text: `${teamLabel(str(p.killerTeam))} slew ROSHAN`,
      })
      continue
    }

    if (e.type === 'tower_kill') {
      out.push({
        tick: e.tick,
        category: 'tower',
        assisters: [],
        text: `${teamLabel(str(p.killerTeam))} razed a ${teamLabel(str(p.team))} tower`,
      })
    }
  }

  return out
}

function killHeadlineText(
  info: {
    killerId: string
    victimId: string
    firstBlood: boolean
    shutdown: boolean
    multi: number
    streak: number
  },
  ctx: NarrativeContext,
): string {
  const killer = ctx.entityLabel(info.killerId)
  const victim = ctx.entityLabel(info.victimId)
  const tags: string[] = []
  if (info.firstBlood) tags.push('FIRST BLOOD')
  if (info.multi >= 2 && MULTI_LABEL[info.multi]) tags.push(MULTI_LABEL[info.multi]!)
  if (info.multi > 5) tags.push('RAMPAGE')
  if (info.shutdown) tags.push('SHUTDOWN')
  if (!info.firstBlood && info.multi < 2 && STREAK_LABEL[info.streak])
    tags.push(STREAK_LABEL[info.streak]!)
  const tag = tags.length ? `${tags.join(' · ')}  ` : ''
  return `${tag}${killer} SIGKILL'd ${victim}`
}
