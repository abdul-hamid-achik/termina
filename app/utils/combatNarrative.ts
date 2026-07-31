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
import { buffLabel } from './buffs'

export interface NarrativeContext {
  /** The local player's id (for salience). */
  playerId: string | null
  /** The local player's team (for ally salience). */
  myTeam?: string
  /** Resolve any entity id to a readable label ("You", hero name, "a wave"…). */
  entityLabel: (id: unknown) => string
  /** Resolve an ability id to its display name. */
  abilityLabel: (id: unknown) => string
  /** The team of an entity id, when known (for ally salience). */
  teamOf: (id: unknown) => string | undefined
  /** Hero id for a player id, when known (for inline avatars). */
  heroIdOf: (id: unknown) => string | undefined
  /** Item display name for an item id. */
  itemName: (id: string) => string
  /** Human zone name for a zone id ("mid-t2-chaff" → "Coldstore T2 (CHAFF)").
   *  Optional — raw ids pass through when absent (older callers/tests). */
  zoneName?: (id: string) => string
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Kill-streak titles (Dota-style), 3 = the first named spree. The SINGLE source
 * of truth shared by the kill-line flair (`killFlair`) and the kill-feed banner
 * (`deriveKillFeed`) so the two can never disagree on what a streak is called.
 */
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
 * The dramatic suffix on a kill line. Ending a fed enemy's run is the SHUTDOWN
 * beat (and pairs with the streak-scaled bounty); otherwise a killer on a 3+
 * run gets a named spree. Empty for ordinary kills.
 */
function killFlair(victimStreak: number, killerStreak: number): string {
  if (victimStreak >= 3) return `  >> SHUTDOWN! (ended a ${victimStreak}-kill streak)`
  if (killerStreak >= 3) {
    // 10+ stays at the top title rather than going unlabeled.
    const label = STREAK_LABEL[killerStreak] ?? 'GODLIKE'
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
const REDUNDANT_GOLD = /wave|last.?hit|burn|passive|neutral/i

/**
 * Map a single engine event to a combat-log line, or `null` to suppress it
 * (internal/spammy events). The giant switch that used to live in
 * GameScreen.vue now lives here, covering every event type.
 */
export function eventToLine(e: GameEvent, ctx: NarrativeContext): CombatLine | null {
  const p = e.payload
  const cycle = e.cycle
  const label = ctx.entityLabel.bind(ctx)
  const zname = (z: unknown) => ctx.zoneName?.(str(z)) ?? str(z)

  switch (e.type) {
    case 'damage': {
      const dtype = str(p.damageType)
      const source = label(p.sourceId)
      const victim = label(p.targetId)
      const line: CombatLine = {
        cycle,
        text: `${source} hit ${victim} for ${num(p.amount)}${dtype ? ` ${dtype}` : ''}`,
        type: 'damage',
        salience: salience(p.sourceId, p.targetId, ctx),
        // Carried on EVERY damage line, not just structure chip: the per-cycle
        // recap sums these, and the teamfight digest reports a real total.
        dmgAmount: num(p.amount),
        sourceLabel: source,
        targetLabel: victim,
      }
      // Repeated chip on a ice/Core collapses into one running line.
      if (isStructureTarget(p.targetId)) {
        line.dedupKey = `dmg:${str(p.sourceId)}->${str(p.targetId)}`
      }
      // Someone else's wave farming — story mode folds these into the per-cycle
      // farm digest. My own hits stay explicit (they're my action's feedback).
      const target = str(p.targetId)
      if (
        (target.startsWith('wave') || target.startsWith('neutral')) &&
        (line.salience === 'ally' || line.salience === 'world')
      ) {
        line.farmKind = 'hit'
      }
      return line
    }

    case 'heal':
      return {
        cycle,
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
        cycle,
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
        p.respawnCycle != null ? ` — respawn ${Math.max(0, num(p.respawnCycle) - cycle)}c` : ''
      return {
        cycle,
        // A hero dying is a headline, not chip damage: typed `kill` so it reads
        // at the same weight as the kill line it accompanies (and so the OBJ
        // filter, which is really "what changed the game", keeps it).
        text: `${label(p.playerId)} was terminated${respawn}`,
        type: 'kill',
        salience: actorSalience(p.playerId, ctx),
      }
    }

    case 'ice_kill':
      return {
        cycle,
        text: `${teamLabel(str(p.killerTeam))} razed the ${teamLabel(str(p.team))} ice in ${zname(p.zone)}`,
        type: 'kill',
        salience: ctx.myTeam === str(p.killerTeam) ? 'mine-out' : 'mine-in',
      }

    case 'terminal_destroyed':
      // Keep the exact "destroyed the … Terminal!" phrasing the victory line expects.
      return {
        cycle,
        text: `${teamLabel(str(p.killerTeam))} destroyed the ${teamLabel(str(p.team))} Terminal!`,
        type: 'victory',
      }

    case 'wave_strip':
      return {
        cycle,
        text: `${label(p.playerId)} last-hit a ${str(p.waveType)} wave (+${num(p.scripAwarded)}sc)`,
        type: 'scrip',
        salience: actorSalience(p.playerId, ctx),
        farmKind: 'lasthit',
        scripAmount: num(p.scripAwarded),
      }

    case 'wave_burn':
      return {
        cycle,
        text: `${label(p.playerId)} burned a ${str(p.waveType)} wave`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
        farmKind: 'burn',
      }

    case 'gold_change': {
      const reason = str(p.reason)
      // Drop scrip lines a dedicated line already narrates (last-hits, burns,
      // passive trickle) — the dominant source of farming-phase noise.
      if (REDUNDANT_GOLD.test(reason)) return null
      const amt = num(p.amount)
      return {
        cycle,
        text: `${label(p.playerId)} ${amt >= 0 ? 'earned' : 'lost'} ${Math.abs(amt)}sc (${reason})`,
        type: 'scrip',
        salience: actorSalience(p.playerId, ctx),
      }
    }

    case 'level_up':
      return {
        cycle,
        // Power-curve beats, not meta-chatter — `[SYS]` grey is reserved for
        // chat, pings and client notices so those stay scannable.
        text: `${label(p.playerId)} reached level ${num(p.newLevel)}`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'ability_used':
      return {
        cycle,
        text: `${label(p.playerId)} cast ${ctx.abilityLabel(p.abilityId)}${p.targetId ? ` on ${label(p.targetId)}` : ''}`,
        type: 'ability',
        // Source→target, not actor-only: a cast aimed at ME is my business, and
        // the story view sorts by salience — ranking it as a bystander event
        // printed the enemy's spell BELOW the damage it caused.
        salience: salience(p.playerId, p.targetId, ctx),
      }

    case 'status_applied': {
      // Loud and uppercase: being disabled is the single most consequential
      // thing that can happen to you in a teamfight, and it was un-narrated.
      const status = buffLabel(str(p.status)).toUpperCase()
      const ticks = num(p.cyclesRemaining)
      const dur = ticks > 0 ? ` (${ticks}c)` : ''
      // Several abilities disable their own caster (Regex's E roots itself while
      // channelling). Reading those out as "You STUNNED You" is nonsense, so a
      // self-application is phrased as a state the actor is in, not an act they
      // performed on someone.
      const victim = label(p.targetId)
      const text =
        p.sourceId === p.targetId
          ? `${victim} ${victim === 'You' ? 'are' : 'is'} ${status}${dur}`
          : `${label(p.sourceId)} ${status} ${victim}${dur}`
      return {
        cycle,
        text,
        type: 'ability',
        salience: salience(p.sourceId, p.targetId, ctx),
      }
    }

    case 'double_cast':
      // Tier-25 exotic proc — loud, so the player notices the ability fired twice.
      return {
        cycle,
        text: `≫ DOUBLE CAST! ${label(p.playerId)}'s ${ctx.abilityLabel(p.abilityId)} fires twice`,
        type: 'ability',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'power_spike':
      // The engine already writes human prose here — surface it instead of JSON.
      return {
        cycle,
        text: str(p.message) || `${label(p.playerId)} hit a power spike`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'item_purchased':
      return {
        cycle,
        text: `${label(p.playerId)} acquired ${ctx.itemName(str(p.itemId))} (-${num(p.cost)}sc)`,
        type: 'scrip',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'item_sold':
      return {
        cycle,
        text: `${label(p.playerId)} sold ${ctx.itemName(str(p.itemId))} (+${num(p.refund)}sc)`,
        type: 'scrip',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'ward_placed':
      return {
        cycle,
        text: `${label(p.playerId)} planted a ${str(p.wardType)} ward in ${zname(p.zone)}`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'cache_picked':
      return {
        cycle,
        // buffLabel: 'dd' → 'Double Damage', 'invis' → 'Invisible', etc.
        text: `${label(p.playerId)} grabbed the ${buffLabel(str(p.cacheType))} cache`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'tenant_killed':
      // Two events share this tag: the public one carries killerTeam+scrip.
      return p.killerTeam
        ? {
            cycle,
            text: `${teamLabel(str(p.killerTeam))} slew Tenant (+${num(p.scripAwarded)}sc)`,
            type: 'objective',
          }
        : { cycle, text: `Tenant has fallen`, type: 'objective' }

    case 'tenant_respawn':
      return { cycle, text: `Tenant has respawned`, type: 'objective' }

    case 'tenant_damage':
      // Chip on Tenant repeats every cycle — collapse like structure damage.
      return {
        cycle,
        text: `Tenant takes ${num(p.damage)} (${num(p.integ)}/${num(p.maxInteg)})`,
        type: 'damage',
        salience: 'world',
        dedupKey: 'dmg:tenant',
        dmgAmount: num(p.damage),
      }

    case 'neutral_killed':
      return {
        cycle,
        text: `${label(p.playerId)} cleared a ${str(p.neutralType).replace(/_/g, ' ')} camp in ${zname(p.zone)}`,
        type: 'scrip',
        salience: actorSalience(p.playerId, ctx),
        farmKind: 'camp',
      }

    case 'backup_picked':
      return {
        cycle,
        text: `${label(p.playerId)} claimed the Backup`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'backup_used':
      return {
        cycle,
        text: `${label(p.playerId)} reincarnated via the Backup`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'talent_selected':
      return {
        cycle,
        text: `${label(p.playerId)} learned ${str(p.talentName)}`,
        type: 'objective',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'teleport_complete':
      return {
        cycle,
        text:
          p.source === 'next_hop'
            ? `${label(p.playerId)}'s return shadow snapped them back to ${zname(p.destination)}`
            : `${label(p.playerId)} teleported to ${zname(p.destination)}`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'trap_triggered':
      // Deliberately carries NO dmgAmount: the engine emits a `damage` event for
      // the same hit, and the per-cycle recap sums dmgAmount across lines — so
      // supplying it here made every trap count twice in "You took N".
      return {
        cycle,
        text: `${label(p.owner)}'s trap caught ${label(p.targetId)} in ${zname(p.zone)} (-${num(p.damage)})`,
        type: 'damage',
        salience: salience(p.owner, p.targetId, ctx),
      }

    case 'spell_blocked': {
      const text =
        p.source === 'mirror_shell'
          ? `${label(p.targetId)}'s Mirror Shell reflected ${label(p.casterId)}'s spell${p.reflected ? ` (-${num(p.reflected)})` : ''}`
          : `${label(p.targetId)}'s ${p.source === 'intercept_shell' ? 'Intercept Shell' : 'Ablative Shell'} blocked ${label(p.casterId)}'s spell`
      return {
        cycle,
        text,
        // A spell that did NOT land is a spell beat — cyan, alongside the cast
        // it negated, rather than lost among the grey notices.
        type: 'ability',
        salience: salience(p.casterId, p.targetId, ctx),
      }
    }

    case 'teleport_cancelled':
      return {
        cycle,
        text: `${label(p.playerId)}'s teleport was cancelled (${str(p.reason)})`,
        type: 'ability',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'night_falls':
      return { cycle, text: `— NIGHT FALLS · vision reduced —`, type: 'objective' }

    case 'day_breaks':
      return { cycle, text: `— DAY BREAKS · full vision —`, type: 'objective' }

    case 'harden_used':
      return {
        cycle,
        text: `${teamLabel(str(p.team))} activated the Harden`,
        type: 'system',
        salience: ctx.myTeam === str(p.team) ? 'ally' : 'world',
      }

    case 'breach_opened': {
      const duration = num(p.durationCycles)
      if (duration <= 0) {
        return {
          cycle,
          text: `${label(p.playerId)} flushed their own BREACH`,
          type: 'system',
          salience: actorSalience(p.playerId, ctx),
        }
      }
      return {
        cycle,
        text: `${label(p.playerId)} BREACHED ${label(p.targetId)} (${duration}c)`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }
    }

    case 'surrender_vote':
      return {
        cycle,
        text: `${teamLabel(str(p.team))} surrender vote: ${num(p.votesFor)}/${num(p.votesNeeded)}`,
        type: 'system',
        salience: ctx.myTeam === str(p.team) ? 'ally' : 'world',
      }

    case 'surrendered':
      return {
        cycle,
        text: `${teamLabel(str(p.team))} surrendered — ${teamLabel(str(p.winner))} wins!`,
        type: 'victory',
      }

    case 'afk_takeover':
      return {
        cycle,
        text: `${label(p.playerId)} ${str(p.message) || 'went AFK — a bot has taken over'}`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }

    case 'ice_invulnerable':
      return {
        cycle,
        text: `The ice in ${zname(p.zone)} is Hardened — attacks do nothing until it expires`,
        type: 'system',
        salience: 'world',
      }

    case 'harden_on_cooldown': {
      const left = num(p.remainingTicks)
      return {
        cycle,
        text: `Harden is not ready — ${left}c remaining`,
        type: 'system',
        salience: actorSalience(p.playerId, ctx),
      }
    }

    // Internal / non-narrative events — intentionally produce no line.
    // `cooldown_used` duplicates the cooldown already shown on the ability
    // slot and always accompanies an `ability_used` line.
    case 'cooldown_used':
      return null

    default:
      return null
  }
}

/**
 * Build the full line list from an event stream: map each event, drop the
 * suppressed ones, then collapse repeated structure/Tenant chip.
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

export type KillCategory = 'hero' | 'ice' | 'tenant' | 'core'

export interface KillFeedEntry {
  cycle: number
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

// STREAK_LABEL is defined once near the top (shared with the kill-line flair).

/**
 * Replay the event stream to derive kill-feed headlines: first blood, multi-
 * kills, shutdowns, and ongoing streaks for hero kills, plus ice/tenant/core
 * headline events. Pure — no store access.
 */
export function deriveKillFeed(events: GameEvent[], ctx: NarrativeContext): KillFeedEntry[] {
  const streaks = new Map<string, number>()
  const lastKillTick = new Map<string, number>()
  const multiCount = new Map<string, number>()
  let firstBloodDone = false
  const out: KillFeedEntry[] = []

  const ordered = [...events].sort((a, b) => a.cycle - b.cycle)

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
        lt != null && e.cycle - lt <= MULTI_KILL_WINDOW ? (multiCount.get(killerId) ?? 1) + 1 : 1
      multiCount.set(killerId, multi)
      lastKillTick.set(killerId, e.cycle)

      const firstBlood = !firstBloodDone
      firstBloodDone = true
      const shutdown = victimStreakBefore >= SHUTDOWN_STREAK

      out.push({
        cycle: e.cycle,
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

    if (e.type === 'terminal_destroyed') {
      out.push({
        cycle: e.cycle,
        category: 'core',
        assisters: [],
        text: `${teamLabel(str(p.killerTeam))} CORE DUMPED the ${teamLabel(str(p.team))} Terminal`,
      })
      continue
    }

    if (e.type === 'tenant_killed' && p.killerTeam) {
      out.push({
        cycle: e.cycle,
        category: 'tenant',
        assisters: [],
        text: `${teamLabel(str(p.killerTeam))} slew TENANT`,
      })
      continue
    }

    if (e.type === 'ice_kill') {
      out.push({
        cycle: e.cycle,
        category: 'ice',
        assisters: [],
        text: `${teamLabel(str(p.killerTeam))} razed a ${teamLabel(str(p.team))} ice`,
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
