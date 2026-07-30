import { ref } from 'vue'
import type { Command, TargetRef } from '~~/shared/types/commands'
import type {
  PlayerState,
  ZoneRuntimeState,
  TeamId,
  CreepState,
  NeutralCreepState,
} from '~~/shared/types/game'
import type { ItemDef } from '~~/shared/types/items'
import type { AbilityDef } from '~~/shared/types/hero'
import { isShopZoneFor, ZONE_IDS, ZONE_MAP } from '~~/shared/constants/zones'
import { zonesForMap } from '~~/shared/constants/maps'
import { findPath } from '~~/shared/pathfinding'
import { HEROES, isHeroId } from '~~/shared/constants/heroes'
import { getTalentTree, talentUnlockLevel } from '~~/shared/constants/talents'
import { getAbilityManaCost } from '~~/shared/utils/ability'
import {
  BUYBACK_BASE_COST,
  BUYBACK_COST_PER_LEVEL,
  SURRENDER_MIN_TICK,
  DENY_HP_THRESHOLD,
  creepMaxHp,
} from '~~/shared/constants/balance'

export interface Suggestion {
  text: string
  description?: string
}

export interface GameContext {
  player: PlayerState | null
  visibleZones: Record<string, ZoneRuntimeState>
  allPlayers: Record<string, PlayerState>
  items?: Record<string, ItemDef>
  /** The whole global neutrals array, in server order — `attack neutral:<i>`
   *  is resolved against that index, so it must not be pre-filtered here. */
  neutrals?: NeutralCreepState[]
  /** The whole global (vision-filtered) creeps array, in server order.
   *  `creep:<i>` is ZONE-local, but the index is derived by counting within
   *  server order — so this must arrive unsorted and unfiltered. */
  creeps?: CreepState[]
  /** Current game tick — enables cooldown/timing validation when provided. */
  tick?: number
  /** Game mode — the tutorial is exempt from the surrender tick gate. */
  mode?: GameMode
}

/**
 * Buyback cost for a player. Prefers the server-computed `buybackCost`
 * (set on death); falls back to mirroring the server formula in
 * BuybackSystem.calculateBuybackCost — base + level scaling + a 10g
 * per-death penalty (the penalty is hardcoded server-side).
 */
export function buybackCostFor(player: PlayerState): number {
  if (player.buybackCost && player.buybackCost > 0) return player.buybackCost
  return BUYBACK_BASE_COST + player.level * BUYBACK_COST_PER_LEVEL + player.deaths * 10
}

/** The one zone Roshan can be attacked from (mirrors ActionResolver's gate). */
const ROSHAN_ZONE = 'hollow'

const SUPPORTIVE_EFFECTS = new Set(['heal', 'shield', 'buff'])
const OFFENSIVE_EFFECTS = new Set([
  'damage',
  'stun',
  'silence',
  'root',
  'slow',
  'dot',
  'debuff',
  'fear',
  'taunt',
  'execute',
])

/** Heal/shield/buff abilities with no offensive component go to allies, not enemies. */
function isSupportiveAbility(ability: AbilityDef): boolean {
  return (
    ability.effects.some((e) => SUPPORTIVE_EFFECTS.has(e.type)) &&
    !ability.effects.some((e) => OFFENSIVE_EFFECTS.has(e.type))
  )
}

function hpPct(p: PlayerState): number {
  return p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 0
}

/**
 * Pick a sensible target string for a quick-cast / shortcut so a targeted
 * ability doesn't silently reject server-side when fired with no target (the
 * "I click Q and nothing happens" report). Mirrors the bot's getAbilityTarget:
 *
 *  - none/self           → no target (cast as-is)
 *  - ally / supportive   → lowest-HP ally in zone (or self for heal/shield)
 *  - hero/unit offensive → lowest-HP enemy in zone
 *  - zone                → the caster's current zone
 *
 * Returns `{ target: null }` to cast with no target, `{ target: 'hero:…' }`
 * with a resolved target string, or `{ error }` when there's no valid target
 * so the caller can surface a hint instead of burning the tick.
 */
export function pickAbilityTargetString(
  ability: AbilityDef,
  player: PlayerState,
  allPlayers: Record<string, PlayerState>,
): { target: string | null } | { error: string } {
  const targetType = ability.targetType as string
  if (targetType === 'none' || targetType === 'self') return { target: null }

  const inZone = Object.values(allPlayers).filter((p) => p.zone === player.zone && p.alive)
  const enemies = inZone.filter((p) => p.team !== player.team)
  const allies = inZone.filter((p) => p.team === player.team && p.id !== player.id)

  if (
    targetType === 'ally' ||
    ((targetType === 'hero' || targetType === 'unit') && isSupportiveAbility(ability))
  ) {
    const selfViable = ability.effects.some((e) => e.type === 'heal' || e.type === 'shield')
    const candidates = selfViable ? [...allies, player] : allies
    if (candidates.length === 0) return { error: `No ally in your zone for ${ability.name}` }
    const target = candidates.reduce((a, b) => (hpPct(a) <= hpPct(b) ? a : b))
    return { target: `hero:${target.id}` }
  }

  if (targetType === 'hero' || targetType === 'unit') {
    if (enemies.length === 0) return { error: `No enemy in your zone for ${ability.name}` }
    const target = enemies.reduce((a, b) => (a.hp < b.hp ? a : b))
    return { target: `hero:${target.id}` }
  }

  if (targetType === 'zone') return { target: `zone:${player.zone}` }

  return { target: null }
}

/**
 * Pick a default target for a bare `attack` (no explicit target): the lowest-HP
 * alive enemy hero in the player's zone — a MOBA right-click on the obvious
 * threat. Returns `{ error }` with a hint when there's no enemy hero. We do NOT
 * auto-attack creeps: last-hitting must stay explicit (attack creep:N) so the
 * auto-target never steals a creep and ruins the player's last-hit timing.
 */
export function pickAttackTargetString(
  player: PlayerState,
  allPlayers: Record<string, PlayerState>,
): { target: string } | { error: string } {
  const enemies = Object.values(allPlayers).filter(
    (p) => p.zone === player.zone && p.alive && p.team !== player.team,
  )
  if (enemies.length === 0) {
    return { error: 'No enemy hero in your zone — target a creep (attack creep:0) or ice' }
  }
  const target = enemies.reduce((a, b) => (a.hp < b.hp ? a : b))
  return { target: `hero:${target.id}` }
}

/**
 * Pick a default target for a bare `use <item>` whose active declares a
 * targetType — so clicking an offensive item (Dagon, Hex, …) nukes the obvious
 * enemy instead of rejecting server-side. Mirrors pickAbilityTargetString:
 * enemy → lowest-HP enemy in zone, ally → lowest-HP ally (or self), self/zone →
 * the player / their zone. Returns `{ error }` when there's no valid target.
 */
export function pickItemTargetString(
  targetType: 'enemy' | 'ally' | 'self' | 'zone',
  player: PlayerState,
  allPlayers: Record<string, PlayerState>,
): { target: string } | { error: string } {
  if (targetType === 'self') return { target: 'self' }
  if (targetType === 'zone') return { target: `zone:${player.zone}` }

  const inZone = Object.values(allPlayers).filter((p) => p.zone === player.zone && p.alive)
  if (targetType === 'ally') {
    const allies = inZone.filter((p) => p.team === player.team && p.id !== player.id)
    const candidates = [...allies, player] // self is a valid ally target
    const target = candidates.reduce((a, b) => (hpPct(a) <= hpPct(b) ? a : b))
    return { target: `hero:${target.id}` }
  }
  // enemy
  const enemies = inZone.filter((p) => p.team !== player.team)
  if (enemies.length === 0) return { error: 'No enemy hero in your zone for that item' }
  const target = enemies.reduce((a, b) => (a.hp < b.hp ? a : b))
  return { target: `hero:${target.id}` }
}

/**
 * The HP a creep spawned with — mirrors the server's deny eligibility check.
 *
 * Reads the stamped value rather than a constant: creeps escalate with match
 * time, so a fixed level-1 max made the deny affordance silently shrink every
 * minute until the client stopped offering a deny the server would have allowed.
 */
function creepFullHp(c: CreepState): number {
  return c.maxHp ?? creepMaxHp(c.type, 0)
}

/**
 * The creeps standing in a zone, paired with the index `creep:<i>` resolves to.
 *
 * Mirrors the server's creepInZoneByIndex: the index counts EVERY creep in the
 * zone in server order — dead-but-unreaped ones included. Dropping corpses
 * before numbering would shift every later suggestion onto a different creep,
 * so callers skip what they don't want to offer and keep the position.
 */
function creepsInZoneWithIndex(
  creeps: CreepState[],
  zone: string,
): Array<{ creep: CreepState; index: number }> {
  return creeps.filter((c) => c.zone === zone).map((creep, index) => ({ creep, index }))
}

/**
 * Pick a default target for a bare `deny`: the lowest-HP ALLIED creep in your
 * zone that's eligible to deny (at/below the deny HP threshold). Returns the
 * server's `creep:<index>` form, where the index is the creep's position among
 * your zone's creeps — the exact convention creepInZoneByIndex resolves.
 */
export function pickDenyTargetString(
  player: PlayerState,
  creeps: CreepState[],
): { target: string } | { error: string } {
  const inZone = creeps.filter((c) => c.zone === player.zone) // same order the server indexes
  let best: { hp: number; index: number } | null = null
  for (let index = 0; index < inZone.length; index++) {
    const c = inZone[index]!
    if (c.team !== player.team || c.hp <= 0) continue
    if (c.hp > creepFullHp(c) * DENY_HP_THRESHOLD) continue // not low enough to deny
    if (best === null || c.hp < best.hp) best = { hp: c.hp, index }
  }
  if (best === null) {
    return { error: 'No denyable allied creep (below 50% HP) in your zone' }
  }
  return { target: `creep:${best.index}` }
}

// ── Informational command readouts ────────────────────────────────
// status/map/scan are client-side: they print a readout to the local log and
// DON'T consume the tick (the server "accepts but ignores" them, so sending one
// would silently waste the player's one action that tick).

const zoneName = (id: string): string => ZONE_MAP[id]?.name ?? id

/** One-line hero summary for the `status` command. */
export function formatStatusReadout(player: PlayerState): string {
  const hero = HEROES[player.heroId ?? '']?.name ?? player.name
  const kda = `${player.kills}/${player.deaths}/${player.assists}`
  return (
    `STATUS · ${hero} Lv${player.level} · ` +
    `HP ${Math.floor(player.hp)}/${player.maxHp} MP ${Math.floor(player.mp)}/${player.maxMp} · ` +
    `${player.gold}g · KDA ${kda} · @ ${zoneName(player.zone)}`
  )
}

/**
 * Your zone + where you can move next, for the `map` command. Read from the
 * GAME's zone set, not the global graph: on the one-lane tutorial map the
 * global `adjacentTo` still lists rune and off-lane neighbours that the game
 * does not contain, so the readout named zones the player could never reach.
 */
export function formatMapReadout(player: PlayerState, mapId?: string): string {
  const zone = zonesForMap(mapId).find((z) => z.id === player.zone)
  const reachable = zone?.adjacentTo.map(zoneName).join(', ') ?? '—'
  return `MAP · You are @ ${zoneName(player.zone)}. Reachable: ${reachable}`
}

/** Enemy heroes currently in your vision, for the `scan` command. */
export function formatScanReadout(
  player: PlayerState,
  allPlayers: Record<string, PlayerState>,
): string {
  const visible = Object.values(allPlayers).filter(
    (p) =>
      p.team !== player.team &&
      p.alive &&
      !(p as { fogged?: boolean }).fogged &&
      typeof p.zone === 'string',
  )
  if (visible.length === 0) return 'SCAN · no enemy heroes in your vision'
  const list = visible
    .map((e) => `${HEROES[e.heroId ?? '']?.name ?? e.name} @ ${zoneName(e.zone)}`)
    .join(', ')
  return `SCAN · ${visible.length} enemy hero${visible.length === 1 ? '' : 'es'} visible: ${list}`
}

/**
 * The command reference for the `help` (or `?`) command — one log line per
 * group so it stays scannable. Pure/static so it can be unit-tested and reused.
 */
export function formatHelpReadout(): string[] {
  return [
    'HELP · type a verb, e.g. `move mid` or `cast q` (most auto-pick a target):',
    '  Fight:   move <zone> · attack <target> · deny · cast <q|w|e|r>',
    '  Items:   buy <item> · sell <item> · use <item> · ward <zone>',
    '  Info:    status · map · scan · missing <enemy>',
    '  Team:    chat <team|all> <msg> · ping <zone> · surrender confirm',
    '  Special: rune · aegis · glyph · buyback · talent <tier> <left|right>',
    '  Shortcuts: q/w/e/r = cast · mv = move · atk = attack · b = buy · ss = missing · ? = help',
    'Goal: push a lane, raze the enemy ice, then destroy their Mainframe.',
  ]
}

export const SHORTCUTS: Record<string, string> = {
  mv: 'move',
  atk: 'attack',
  q: 'cast q',
  w: 'cast w',
  e: 'cast e',
  r: 'cast r',
  b: 'buy',
}

// Zone aliases for easier typing
const ZONE_ALIASES: Record<string, string> = {
  // Lane shortcuts
  mid: 'mid-river',
  top: 'top-river',
  bot: 'bot-river',
  // Full lane paths
  'top-lane': 'top-t1-chaff',
  'mid-lane': 'mid-river',
  'bot-lane': 'bot-river',
  // Jungles — the Silt
  'jg-chaff': 'silt-chaff-top',
  'jg-audit': 'silt-audit-top',
  'silt-chaff': 'silt-chaff-top',
  'silt-audit': 'silt-audit-top',
  // Bases
  base: 'chaff-base',
  fountain: 'chaff-fountain',
  // The Tenant's pit
  hollow: 'hollow',
  // Cache drops. There is deliberately no bare `cache` alias: it used to point
  // at mid-river, a zone with no cache in it, so `move cache` walked you past both.
  'cache-top': 'cache-top',
  'cache-bot': 'cache-bot',
  rt: 'cache-top',
  rb: 'cache-bot',
}

function parseTarget(raw: string): TargetRef | null {
  if (raw === 'self') return { kind: 'self' }
  // The enemy team's core structure ("the Mainframe")
  if (raw === 'ancient' || raw === 'mainframe' || raw === 'core') return { kind: 'ancient' }
  if (raw.startsWith('hero:')) return { kind: 'hero', name: raw.slice(5) }
  if (raw.startsWith('creep:')) {
    const idx = Number.parseInt(raw.slice(6), 10)
    if (!Number.isNaN(idx)) return { kind: 'creep', index: idx }
  }
  // Unlike `creep:<i>` (zone-local), the index here is the position in the
  // GLOBAL neutrals array — that is what the server resolves it against, and
  // the array reaches the client unfiltered (neutrals are public info).
  if (raw.startsWith('neutral:')) {
    const idx = Number.parseInt(raw.slice(8), 10)
    if (!Number.isNaN(idx)) return { kind: 'neutral', index: idx }
  }
  if (raw.startsWith('ice:')) return { kind: 'ice', zone: raw.slice(4) }
  if (raw.startsWith('zone:')) return { kind: 'zone', zone: raw.slice(5) }
  if (raw === 'roshan' || raw === 'rosh') return { kind: 'roshan' }
  // If it looks like a hero name without prefix, try hero
  if (isHeroId(raw)) return { kind: 'hero', name: raw }
  return null
}

export interface ParseResult {
  command: Command | null
  error: string | null
}

// Exact-id sets (mirrors the server's DEBUFF_ID_SETS) — NOT substring matching,
// which would silently disable actions if a future buff id contained a debuff
// substring (e.g. a hypothetical `stun_immune`).
const DEBUFF_ID_SETS = {
  stun: new Set(['stun']),
  root: new Set(['root']),
  silence: new Set(['silence']),
  feared: new Set(['feared']),
  taunt: new Set(['taunt']),
  cyclone: new Set(['cyclone']),
  hex: new Set(['hex']),
} as const

type DebuffType = keyof typeof DEBUFF_ID_SETS

function hasDebuff(player: PlayerState, type: DebuffType): boolean {
  return player.buffs.some((b) => DEBUFF_ID_SETS[type].has(b.id))
}

/**
 * Pre-flight validation mirroring the server's validateAction rules
 * (ActionResolver.ts) so illegal actions are caught before submission
 * instead of wasting the player's one action this tick.
 * Returns an error string, or null if the command would be accepted.
 */
export function validateCommand(command: Command, context: GameContext): string | null {
  const player = context.player
  if (!player) return null
  // Buyback and surrender are exactly the commands a dead player needs —
  // they bypass the dead-player gate (server handles them as special actions).
  if (
    !player.alive &&
    command.type !== 'buyback' &&
    command.type !== 'surrender' &&
    command.type !== 'select_talent'
  ) {
    return 'Cannot act while dead'
  }
  // Hard disables that pierce BKB (mirror the server): Cyclone + Hex fully
  // disable — no move/attack/cast. (select_talent is a meta-action, exempted as
  // it is for the dead-player gate above.)
  if (hasDebuff(player, 'cyclone') && command.type !== 'select_talent') {
    return 'Cannot act while cycloned'
  }
  if (hasDebuff(player, 'hex') && command.type !== 'select_talent') {
    return 'Cannot act while hexed'
  }
  // Black King Bar (magic_immune) lets a hero act through the SOFT control
  // debuffs (stun/silence/root/fear/taunt). The client previously had no such
  // concept, so it falsely blocked BKB heroes that the server would let act.
  const debuffImmune = player.buffs.some((b) => b.id === 'magic_immune')

  switch (command.type) {
    case 'buyback': {
      if (player.alive) return 'Buyback is only available while dead'
      if (
        context.tick !== undefined &&
        player.buybackCooldown &&
        context.tick < player.buybackCooldown
      ) {
        return `Buyback on cooldown (${player.buybackCooldown - context.tick} cycles remaining)`
      }
      const cost = buybackCostFor(player)
      if (player.gold < cost) {
        return `Not enough gold for buyback (need ${cost - player.gold}g more)`
      }
      return null
    }
    case 'surrender': {
      // Mirrors SurrenderSystem.canSurrender: the tick gate stops rage-quits in
      // a real match, but the tutorial is single-player and ends long before
      // tick 225 — gating it there just traps a learner with no way out.
      if (
        context.mode !== 'tutorial' &&
        context.tick !== undefined &&
        context.tick < SURRENDER_MIN_TICK
      ) {
        return `Too early to surrender (available at cycle ${SURRENDER_MIN_TICK})`
      }
      return null
    }
    case 'move': {
      const zone = ZONE_MAP[player.zone]
      if (!zone) return null
      // Auto-path (mirrors the server): ANY zone on this game's map with a path
      // from here is a valid order — the hero walks one zone per tick toward it.
      // `visibleZones` is the full game zone set (not vision-filtered); skip the
      // subset check until it's populated.
      const gameZones = context.visibleZones
      const hasGameZones = Object.keys(gameZones).length > 0
      if (command.zone !== player.zone && hasGameZones && !gameZones[command.zone]) {
        return `${command.zone} isn't on this map`
      }
      if (
        command.zone !== player.zone &&
        findPath(player.zone, command.zone, hasGameZones ? (id) => !!gameZones[id] : undefined)
          .length === 0
      ) {
        return `No path from ${player.zone} to ${command.zone}`
      }
      if (!debuffImmune && (hasDebuff(player, 'root') || hasDebuff(player, 'stun'))) {
        return 'Cannot move while rooted or stunned'
      }
      if (!debuffImmune && hasDebuff(player, 'taunt')) return 'Cannot move while taunted'
      return null
    }
    case 'attack': {
      if (!debuffImmune && hasDebuff(player, 'stun')) return 'Cannot attack while stunned'
      if (!debuffImmune && hasDebuff(player, 'feared')) return 'Cannot attack while feared'
      // Ghost Scepter: phased out — cannot attack (pierces BKB; not a debuff).
      if (player.buffs.some((b) => b.id === 'ghost_form'))
        return 'Cannot attack while in ghost form'
      const t = command.target
      if (t.kind === 'hero') {
        const target = Object.values(context.allPlayers).find(
          (p) => p.heroId === t.name || p.name.toLowerCase() === t.name.toLowerCase(),
        )
        if (target && (!target.alive || target.zone !== player.zone)) {
          return `${t.name} is not in your zone`
        }
      }
      if (t.kind === 'ice' && t.zone !== player.zone) {
        return 'Must be in the ice’s zone to attack it'
      }
      if (t.kind === 'roshan' && player.zone !== ROSHAN_ZONE) {
        return `Must be in the ${ROSHAN_ZONE} to attack Roshan`
      }
      // Only checkable when the caller supplied the neutrals array; without it
      // the server still enforces both rules, we just can't warn ahead of time.
      if (t.kind === 'neutral' && context.neutrals) {
        const neutral = context.neutrals[t.index]
        if (!neutral || !neutral.alive) return `No neutral creep at index ${t.index}`
        if (neutral.zone !== player.zone) return 'That neutral camp is not in your zone'
      }
      if (t.kind === 'ancient') {
        const enemyBase = player.team === 'chaff' ? 'audit-base' : 'chaff-base'
        if (player.zone !== enemyBase) {
          return `Must be in the enemy base (${enemyBase}) to attack their Mainframe`
        }
      }
      return null
    }
    case 'cast': {
      if (!debuffImmune && hasDebuff(player, 'stun')) return 'Cannot cast while stunned'
      if (!debuffImmune && hasDebuff(player, 'silence')) return 'Cannot cast while silenced'
      if (!debuffImmune && hasDebuff(player, 'feared')) return 'Cannot cast while feared'
      if (!debuffImmune && hasDebuff(player, 'taunt')) return 'Cannot cast while taunted'
      if (!player.heroId) return 'No hero selected'
      const hero = HEROES[player.heroId]
      if (!hero) return null
      const ability = hero.abilities[command.ability]
      if (!ability) return 'Unknown ability'
      // Auto-leveling gate (mirrors the server's getAbilityLevel): Q/W/E unlock
      // at level 1, the ultimate (R) at level 6 — reject early so the player
      // doesn't waste their one action this tick on a server-rejected cast.
      if (command.ability === 'r' && player.level < 6) return 'Ultimate unlocks at level 6'
      const cd = player.cooldowns[command.ability]
      if (cd > 0) return `${ability.name} on cooldown (${cd} cycle${cd === 1 ? '' : 's'})`
      // What the ENGINE will charge at this level, not the rank-1 figure in the
      // registry. Validating against the flat cost told the player a cast was
      // affordable and then the server refused it — the pre-flight existed
      // precisely to stop that.
      const cost = getAbilityManaCost(ability, command.ability, player.level)
      if (player.mp < cost) {
        return `Not enough mana (need ${cost}, have ${player.mp})`
      }
      return null
    }
    case 'buy': {
      if (!isShopZoneFor(player.zone, player.team))
        return 'Not in a shop zone — return to YOUR base or fountain'
      const item = context.items?.[command.item]
      if (item) {
        if (player.gold < item.cost) {
          return `Not enough gold (need ${item.cost - player.gold}g more)`
        }
        const stackCap = item.consumable ? (item.maxStacks ?? Infinity) : (item.maxStacks ?? 1)
        const ownedCount = player.items.filter((i) => i === command.item).length
        if (ownedCount >= stackCap) {
          return `Already own ${item.name}${stackCap > 1 ? ` (max ${stackCap})` : ''}`
        }
        if (player.items.every((slot) => slot !== null)) {
          return 'Inventory full (6/6) — sell an item first'
        }
      }
      return null
    }
    case 'sell': {
      if (!isShopZoneFor(player.zone, player.team))
        return 'Not in a shop zone — return to YOUR base or fountain'
      if (!player.items.includes(command.item)) return 'Item not owned'
      return null
    }
    case 'use': {
      if (!player.items.includes(command.item)) return 'Item not owned'
      const item = context.items?.[command.item]
      if (item && !item.active) return `${item.name} has no active ability`
      const cdBuff = player.buffs.find((b) => b.id === `item_cd_${command.item}`)
      if (cdBuff && cdBuff.ticksRemaining > 0) {
        return `Item on cooldown (${cdBuff.ticksRemaining} cycles)`
      }
      return null
    }
    case 'ward': {
      const zone = ZONE_MAP[player.zone]
      if (!zone) return null
      if (command.zone !== player.zone && !zone.adjacentTo.includes(command.zone)) {
        return 'Ward zone must be current or adjacent'
      }
      return null
    }
    case 'select_talent': {
      if (!player.heroId) return 'No hero selected'
      // The tier NAME is an identifier, not a level requirement — mirror the
      // server's talentUnlockLevel or this pre-flight refuses a command the
      // engine would have accepted, and the retuned (earlier) tiers stay
      // untypeable.
      const required = talentUnlockLevel(command.tier)
      if (player.level < required) {
        return `Reach level ${required} to choose this talent (you are level ${player.level})`
      }
      const key = `tier${command.tier}` as const
      if (player.talents[key]) return `You already chose your tier-${command.tier} talent`
      return null
    }
    default:
      return null
  }
}

/**
 * Resolve a zone alias to the actual zone ID, or return the input if it's
 * already a valid zone. `base`/`fountain` are resolved relative to the player's
 * team — so a audit player typing `move base` heads to audit-base, not the enemy's.
 */
function resolveZoneAlias(zoneInput: string, team: TeamId = 'chaff'): string {
  // Check if it's already a valid zone ID
  if (ZONE_IDS.includes(zoneInput)) return zoneInput
  // Team-relative "home" shortcuts resolve to YOUR side of the map.
  if (zoneInput === 'base') return `${team}-base`
  if (zoneInput === 'fountain') return `${team}-fountain`
  // Check if it's an alias
  if (ZONE_ALIASES[zoneInput]) return ZONE_ALIASES[zoneInput]
  // Check if it matches a zone ID prefix (e.g., "mid" -> "mid-river" if unambiguous)
  const matches = ZONE_IDS.filter((z) => z.startsWith(zoneInput))
  if (matches.length === 1) return matches[0]!
  // Return as-is (let server validate)
  return zoneInput
}

/**
 * Zone words that match several zones and so resolve to nothing. Left
 * unreported these reach the server as a raw prefix and are rejected there,
 * costing the player their one action for the tick with no explanation.
 */
function ambiguousZoneError(zoneInput: string): string | null {
  if (ZONE_IDS.includes(zoneInput) || zoneInput === 'base' || zoneInput === 'fountain') return null
  if (ZONE_ALIASES[zoneInput]) return null
  // Legacy word from the old vocabulary: `rune` matched both rune spots. The
  // spots are cache-top/cache-bot now, but a player who types `move rune` still
  // means "a cache drop" — guide them to both rather than dumping a raw prefix
  // on the server (which would burn their one action on a rejection).
  if (zoneInput === 'rune') {
    return `"rune" is ambiguous — did you mean cache-top or cache-bot?`
  }
  const matches = ZONE_IDS.filter((z) => z.startsWith(zoneInput))
  if (matches.length < 2) return null
  return matches.length > 3
    ? `"${zoneInput}" is ambiguous — ${matches.length} zones match (${matches.slice(0, 3).join(', ')}, ...)`
    : `"${zoneInput}" is ambiguous — did you mean ${matches.join(' or ')}?`
}

export function useCommands() {
  const history = ref<string[]>([])
  const historyIndex = ref(-1)

  function parse(input: string, team: TeamId = 'chaff'): ParseResult {
    let trimmed = input.trim().toLowerCase()
    if (!trimmed) return { command: null, error: null }

    // Expand shortcuts
    const parts = trimmed.split(/\s+/)
    const shortcut = SHORTCUTS[parts[0]!]
    if (shortcut) {
      trimmed = shortcut + (parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '')
    }

    const tokens = trimmed.split(/\s+/)
    const cmd = tokens[0]!

    switch (cmd) {
      case 'move': {
        const zone = tokens[1]
        if (!zone) return { command: null, error: 'Usage: move <zone>' }
        const ambiguous = ambiguousZoneError(zone)
        if (ambiguous) return { command: null, error: ambiguous }
        const resolvedZone = resolveZoneAlias(zone, team)
        return { command: { type: 'move', zone: resolvedZone }, error: null }
      }

      case 'attack': {
        const targetStr = tokens[1]
        if (!targetStr)
          return {
            command: null,
            error:
              'Usage: attack <target>  (e.g. attack hero:daemon, attack creep:0, attack neutral:0, attack roshan, attack ice:mid-t1-chaff, attack ancient)',
          }
        const target = parseTarget(targetStr)
        if (!target)
          return {
            command: null,
            error: `Invalid target "${targetStr}". Use hero:<name>, creep:<index>, neutral:<index>, ice:<zone>, roshan, ancient, or self`,
          }
        return { command: { type: 'attack', target }, error: null }
      }

      case 'deny': {
        const targetStr = tokens[1]
        if (!targetStr)
          return {
            command: null,
            error:
              'Usage: deny <creep:index>  (deny an allied creep below 50% HP to starve the enemy of gold/XP)',
          }
        const target = parseTarget(targetStr)
        if (!target || target.kind !== 'creep')
          return {
            command: null,
            error: `Can only deny allied creeps. Use creep:<index> (e.g. deny creep:0)`,
          }
        return { command: { type: 'deny', target }, error: null }
      }

      case 'cast': {
        const ability = tokens[1] as 'q' | 'w' | 'e' | 'r'
        if (!['q', 'w', 'e', 'r'].includes(ability))
          return { command: null, error: 'Usage: cast <q|w|e|r> [target]' }
        const targetStr = tokens[2]
        const target = targetStr ? parseTarget(targetStr) : undefined
        return { command: { type: 'cast', ability, target: target ?? undefined }, error: null }
      }

      case 'use': {
        const item = tokens[1]
        if (!item) return { command: null, error: 'Usage: use <item> [target]' }
        const targetStr = tokens[2]
        const target = targetStr ? (parseTarget(targetStr) ?? targetStr) : undefined
        return { command: { type: 'use', item, target }, error: null }
      }

      case 'buy': {
        const item = tokens[1]
        if (!item) return { command: null, error: 'Usage: buy <item>' }
        return { command: { type: 'buy', item }, error: null }
      }

      case 'sell': {
        const item = tokens[1]
        if (!item) return { command: null, error: 'Usage: sell <item>' }
        return { command: { type: 'sell', item }, error: null }
      }

      case 'ward': {
        const zone = tokens[1]
        if (!zone) return { command: null, error: 'Usage: ward <zone>' }
        const ambiguous = ambiguousZoneError(zone)
        if (ambiguous) return { command: null, error: ambiguous }
        const resolvedZone = resolveZoneAlias(zone, team)
        return { command: { type: 'ward', zone: resolvedZone }, error: null }
      }

      case 'talent': {
        const tier = Number.parseInt(tokens[1] ?? '', 10)
        if (![10, 15, 20, 25].includes(tier)) {
          return { command: null, error: 'Usage: talent <10|15|20|25> <left|right>' }
        }
        const choice = tokens[2]
        if (!choice) {
          return { command: null, error: 'Usage: talent <10|15|20|25> <left|right>' }
        }
        // `left`/`right` are resolved against the hero's tree in GameScreen
        // (needs hero context); a full talentId may also be passed directly.
        return {
          command: { type: 'select_talent', tier: tier as 10 | 15 | 20 | 25, talentId: choice },
          error: null,
        }
      }

      case 'scan':
        return { command: { type: 'scan' }, error: null }

      case 'status':
        return { command: { type: 'status' }, error: null }

      case 'map':
        return { command: { type: 'map' }, error: null }

      case 'help':
      case '?':
        return { command: { type: 'help' }, error: null }

      case 'missing':
      case 'miss':
      case 'ss': {
        const enemy = tokens.slice(1).join(' ')
        if (!enemy) return { command: null, error: 'Usage: missing <enemy hero>' }
        return { command: { type: 'missing', enemyId: enemy }, error: null }
      }

      case 'aegis':
        return { command: { type: 'aegis' }, error: null }

      case 'rune':
        return { command: { type: 'rune' }, error: null }

      case 'chat': {
        const channel = tokens[1] as 'team' | 'all'
        if (!['team', 'all'].includes(channel))
          return { command: null, error: 'Usage: chat <team|all> <message>' }
        const message = tokens.slice(2).join(' ')
        if (!message) return { command: null, error: 'Usage: chat <team|all> <message>' }
        return { command: { type: 'chat', channel, message }, error: null }
      }

      case 'ping': {
        const zone = tokens[1]
        if (!zone) return { command: null, error: 'Usage: ping <zone>' }
        const ambiguous = ambiguousZoneError(zone)
        if (ambiguous) return { command: null, error: ambiguous }
        const resolvedZone = resolveZoneAlias(zone, team)
        return { command: { type: 'ping', zone: resolvedZone }, error: null }
      }

      case 'glyph':
        return { command: { type: 'glyph' }, error: null }

      case 'buyback':
        return { command: { type: 'buyback' }, error: null }

      case 'surrender': {
        // Confirm step so a match isn't thrown by a fat-fingered command
        const arg = tokens[1]
        if (arg === 'confirm' || arg === 'yes') {
          return { command: { type: 'surrender', vote: 'yes' }, error: null }
        }
        if (arg === 'cancel' || arg === 'no') {
          return { command: { type: 'surrender', vote: 'no' }, error: null }
        }
        return {
          command: null,
          error:
            "Surrender requires confirmation — type 'surrender confirm' to vote yes, or 'surrender cancel' to retract your vote",
        }
      }

      default:
        return {
          command: null,
          error: `Unknown command: ${cmd}. Type \`help\` (or \`?\`) for the full command list.`,
        }
    }
  }

  function autocomplete(input: string, context: GameContext): Suggestion[] {
    const trimmed = input.trim().toLowerCase()
    if (!trimmed) return []

    const parts = trimmed.split(/\s+/)

    // Expand shortcut for first token matching
    if (parts.length === 1) {
      const cmds = [
        'move',
        'attack',
        'deny',
        'cast',
        'use',
        'buy',
        'sell',
        'ward',
        'aegis',
        'rune',
        'scan',
        'status',
        'map',
        'help',
        'missing',
        'chat',
        'ping',
        'glyph',
        'talent',
        'buyback',
        'surrender',
      ]
      const shortcuts = Object.keys(SHORTCUTS)
      const all = [...cmds, ...shortcuts]
      const descriptions: Record<string, string> = {
        help: 'List every command (and the goal of the game)',
        missing: 'Alert your team an enemy is missing (alias: ss)',
        buyback: 'Pay gold to respawn instantly (while dead)',
        surrender: "Vote to forfeit — requires 'surrender confirm'",
        talent: 'Choose a talent (tiers 10/15/20/25)',
        deny: 'Last-hit your own creep below 50% HP to deny the enemy',
      }
      return all
        .filter((c) => c.startsWith(parts[0]!))
        .map((c) => ({
          text: c,
          description: SHORTCUTS[c] ? `→ ${SHORTCUTS[c]}` : descriptions[c],
        }))
    }

    const expanded = SHORTCUTS[parts[0]!] ?? parts[0]!
    const expandedTokens = expanded.split(/\s+/)
    const baseCmd = expandedTokens[0]

    // Determine what we're completing
    // For "cast q <target>", we already have ability slot from shortcut expansion
    if (baseCmd === 'move' || expanded === 'move') {
      return _suggestZones(parts.slice(1).join(' '), context)
    }

    if (baseCmd === 'attack') {
      return _suggestTargets(parts.slice(1).join(' '), context)
    }

    if (baseCmd === 'deny') {
      // Deny only targets allied creeps in the current zone. The server enforces
      // the HP rule, so healthy allies are still offered — with their HP, which
      // is the number the player is waiting on.
      const partial = parts.slice(1).join(' ')
      const player = context.player
      const out: Suggestion[] = []
      if (player && context.creeps) {
        for (const { creep, index } of creepsInZoneWithIndex(context.creeps, player.zone)) {
          if (creep.team !== player.team || creep.hp <= 0) continue
          const ref = `creep:${index}`
          if (!ref.includes(partial)) continue
          const denyable = creep.hp <= creepFullHp(creep) * DENY_HP_THRESHOLD
          out.push({
            text: ref,
            description: `${creep.type} (HP: ${Math.ceil(creep.hp)}/${creepFullHp(creep)})${
              denyable ? ' — denyable' : ''
            }`,
          })
        }
      }
      return out.slice(0, 10)
    }

    if (baseCmd === 'cast') {
      // If we only have "cast" + partial, suggest ability slots
      if (expandedTokens.length === 1 && parts.length === 2) {
        const slot = parts[1]!
        return ['q', 'w', 'e', 'r']
          .filter((s) => s.startsWith(slot))
          .map((s) => ({ text: `cast ${s}` }))
      }
      // If we have the slot, suggest targets
      const partial =
        expandedTokens.length === 2 ? parts.slice(1).join(' ') : parts.slice(2).join(' ')
      return _suggestTargets(partial, context)
    }

    if (baseCmd === 'buy') {
      return _suggestBuyItems(parts.slice(1).join(' '), context)
    }

    if (baseCmd === 'sell') {
      return _suggestOwnedItems(parts.slice(1).join(' '), context)
    }

    if (baseCmd === 'use') {
      return _suggestActiveItems(parts.slice(1).join(' '), context)
    }

    if (baseCmd === 'ward') {
      return _suggestAdjacentZones(parts.slice(1).join(' '), context)
    }

    if (baseCmd === 'chat') {
      if (parts.length === 2) {
        const partial = parts[1]!
        return ['team', 'all']
          .filter((c) => c.startsWith(partial))
          .map((c) => ({ text: `chat ${c}` }))
      }
    }

    if (baseCmd === 'ping') {
      return _suggestZones(parts.slice(1).join(' '), context)
    }

    if (baseCmd === 'talent') {
      const heroId = context.player?.heroId
      const tree = heroId ? getTalentTree(heroId) : undefined
      // "talent <tier>" — offer reached, unchosen tiers
      if (parts.length === 2) {
        const partial = parts[1]!
        const tiers = [10, 15, 20, 25] as const
        return tiers
          .filter((t) => String(t).startsWith(partial))
          .filter((t) => {
            const p = context.player
            if (!p) return true
            return p.level >= t && !p.talents[`tier${t}` as const]
          })
          .map((t) => ({ text: `talent ${t}`, description: `Choose your level ${t} talent` }))
      }
      // "talent <tier> <left|right>" — name the two options
      if (parts.length === 3 && tree) {
        const tier = Number.parseInt(parts[1]!, 10) as 10 | 15 | 20 | 25
        const tierTalents = [10, 15, 20, 25].includes(tier) ? tree.tiers[tier] : undefined
        if (tierTalents) {
          const partial = parts[2]!
          return (['left', 'right'] as const)
            .filter((side) => side.startsWith(partial))
            .map((side) => ({
              text: `talent ${tier} ${side}`,
              description: tierTalents[side === 'left' ? 0 : 1]?.name,
            }))
        }
      }
      return []
    }

    if (baseCmd === 'surrender' && parts.length === 2) {
      const partial = parts[1]!
      return [
        { text: 'surrender confirm', description: 'Vote yes to forfeit the game' },
        { text: 'surrender cancel', description: 'Retract your surrender vote' },
      ].filter((s) => s.text.split(' ')[1]!.startsWith(partial))
    }

    return []
  }

  function _suggestZones(partial: string, context: GameContext): Suggestion[] {
    const visibleIds = Object.keys(context.visibleZones)
    const zonePool = visibleIds.length > 0 ? visibleIds : ZONE_IDS

    const suggestions: Suggestion[] = []
    const team = context.player?.team ?? 'chaff'

    // An exact alias outranks every prefix match: `mid` means the river, and
    // burying it under `mid-t3-chaff` (first in zone order) walked players into
    // their OWN tier-3 ice the moment Enter accepted the top suggestion.
    const exact = partial ? resolveZoneAlias(partial, team) : ''
    if (exact !== partial && zonePool.includes(exact) && ZONE_MAP[exact]) {
      suggestions.push({ text: partial, description: `→ ${ZONE_MAP[exact]!.name}` })
    }

    // First add prefix matches (higher priority)
    const prefixMatches = zonePool.filter((id) => id.startsWith(partial))
    for (const id of prefixMatches) {
      suggestions.push({ text: id, description: ZONE_MAP[id]?.name })
    }

    // Legacy word: `rune` matched both rune spots — offer the cache drops.
    if (partial === 'rune') {
      for (const id of zonePool.filter((z) => z.startsWith('cache-'))) {
        if (!suggestions.some((s) => s.text === id)) {
          suggestions.push({ text: id, description: ZONE_MAP[id]?.name })
        }
      }
    }

    // Then add substring matches that aren't prefix matches
    const substringMatches = zonePool.filter(
      (id) => !id.startsWith(partial) && id.includes(partial),
    )
    for (const id of substringMatches) {
      suggestions.push({ text: id, description: ZONE_MAP[id]?.name })
    }

    // Also suggest aliases that match. base/fountain resolve to the player's
    // OWN side, so describe them team-relatively to match what they'll do.
    const matchingAliases = Object.keys(ZONE_ALIASES).filter(
      (alias) => alias.startsWith(partial) || alias.includes(partial),
    )
    for (const alias of matchingAliases) {
      if (!suggestions.some((s) => s.text === alias)) {
        const resolvedId = resolveZoneAlias(alias, team)
        suggestions.push({
          text: alias,
          description: `→ ${ZONE_MAP[resolvedId]?.name ?? resolvedId}`,
        })
      }
    }

    return suggestions.slice(0, 10)
  }

  function _suggestAdjacentZones(partial: string, context: GameContext): Suggestion[] {
    if (!context.player) return _suggestZones(partial, context)
    const zone = ZONE_MAP[context.player.zone]
    if (!zone) return []

    const suggestions: Suggestion[] = []
    const adjacent = zone.adjacentTo

    // Same alias-first rule as _suggestZones, but only for a reachable zone —
    // `ward mid` from a mid lane means the river, not the ice behind you.
    const exact = partial ? resolveZoneAlias(partial, context.player.team) : ''
    if (exact !== partial && adjacent.includes(exact) && ZONE_MAP[exact]) {
      suggestions.push({ text: partial, description: `→ ${ZONE_MAP[exact]!.name}` })
    }

    // Prefix matches first
    const prefixMatches = adjacent.filter((id) => id.startsWith(partial))
    for (const id of prefixMatches) {
      suggestions.push({ text: id, description: ZONE_MAP[id]?.name })
    }

    // Then substring matches
    const substringMatches = adjacent.filter(
      (id) => !id.startsWith(partial) && id.includes(partial),
    )
    for (const id of substringMatches) {
      suggestions.push({ text: id, description: ZONE_MAP[id]?.name })
    }

    // Also suggest aliases for adjacent zones
    for (const zoneId of adjacent) {
      const matchingAliases = Object.entries(ZONE_ALIASES).filter(
        ([alias, zid]) => zid === zoneId && (alias.startsWith(partial) || alias.includes(partial)),
      )
      for (const [alias] of matchingAliases) {
        if (!suggestions.some((s) => s.text === alias)) {
          suggestions.push({ text: alias, description: `→ ${ZONE_MAP[zoneId]?.name}` })
        }
      }
    }

    return suggestions
  }

  function _suggestTargets(partial: string, context: GameContext): Suggestion[] {
    const suggestions: Suggestion[] = []
    if (!context.player) return suggestions

    // Suggest enemy heroes in zone
    const enemies = Object.values(context.allPlayers).filter(
      (p) => p.zone === context.player!.zone && p.team !== context.player!.team && p.alive,
    )
    for (const e of enemies) {
      const ref = `hero:${e.heroId ?? e.name}`
      if (ref.includes(partial)) {
        suggestions.push({ text: ref, description: `${e.name} (HP: ${e.hp}/${e.maxHp})` })
      }
    }

    // Suggest creep targets. Corpses keep their slot in the numbering (see
    // creepsInZoneWithIndex) but are never offered — the server rejects them.
    if (context.creeps) {
      for (const { creep, index } of creepsInZoneWithIndex(context.creeps, context.player.zone)) {
        if (creep.hp <= 0) continue
        // Your OWN creeps are the `deny` command's business, never an attack
        // target — the server refuses them, and in a one-action-per-tick game
        // an offered target that always fails costs the player the whole tick.
        // Indices are unaffected: creepsInZoneWithIndex numbers the zone's
        // creeps, so skipping one here does not renumber the rest.
        if (creep.team === context.player.team) continue
        const ref = `creep:${index}`
        if (!ref.includes(partial)) continue
        suggestions.push({
          text: ref,
          description: `${creep.type} enemy (HP: ${Math.ceil(creep.hp)}/${creepFullHp(creep)})`,
        })
      }
    }

    // Suggest neutral camps standing in this zone. The offered index is the
    // GLOBAL array position, not the position among the in-zone survivors —
    // filtering first and re-indexing would point the attack at another camp.
    if (context.neutrals) {
      for (let i = 0; i < context.neutrals.length; i++) {
        const n = context.neutrals[i]!
        if (!n.alive || n.zone !== context.player.zone) continue
        const ref = `neutral:${i}`
        if (ref.includes(partial)) {
          suggestions.push({ text: ref, description: `${n.type} (HP: ${n.hp}/${n.maxHp})` })
        }
      }
    }

    // Suggest Roshan from inside the pit
    if (context.player.zone === ROSHAN_ZONE && 'roshan'.includes(partial)) {
      suggestions.push({ text: 'roshan', description: 'Roshan (drops the Aegis)' })
    }

    // Suggest ice if present
    if (ZONE_MAP[context.player.zone]?.ice) {
      const ref = `ice:${context.player.zone}`
      if (ref.includes(partial)) {
        suggestions.push({ text: ref, description: 'Ice' })
      }
    }

    // Suggest the enemy Mainframe when standing in the enemy base
    const enemyBase = context.player.team === 'chaff' ? 'audit-base' : 'chaff-base'
    if (context.player.zone === enemyBase && 'mainframe'.includes(partial)) {
      suggestions.push({ text: 'mainframe', description: 'Enemy Mainframe (win the game!)' })
    }

    // Suggest self
    if ('self'.includes(partial)) {
      suggestions.push({ text: 'self', description: 'Self-target' })
    }

    return suggestions.slice(0, 10)
  }

  function _suggestBuyItems(partial: string, context: GameContext): Suggestion[] {
    if (!context.items) return []
    const gold = context.player?.gold ?? 0
    return Object.values(context.items)
      .filter((item) => item.id.includes(partial) || item.name.toLowerCase().includes(partial))
      .slice(0, 10)
      .map((item) => ({
        text: item.id,
        description: `${item.name} (${item.cost}g)${gold >= item.cost ? ' [affordable]' : ' [need ' + (item.cost - gold) + 'g]'}`,
      }))
  }

  function _suggestOwnedItems(partial: string, context: GameContext): Suggestion[] {
    if (!context.player || !context.items) return []
    const owned = context.player.items.filter((id): id is string => id != null)
    const unique = [...new Set(owned)]
    return unique
      .filter((id) => id.includes(partial))
      .map((id) => {
        const item = context.items![id]
        return {
          text: id,
          description: item ? `${item.name} (sell: ${Math.floor(item.cost / 2)}g)` : id,
        }
      })
  }

  function _suggestActiveItems(partial: string, context: GameContext): Suggestion[] {
    if (!context.player || !context.items) return []
    const owned = context.player.items.filter((id): id is string => id != null)
    const unique = [...new Set(owned)]
    return unique
      .filter((id) => {
        const item = context.items![id]
        return item?.active && id.includes(partial)
      })
      .map((id) => {
        const item = context.items![id]!
        return { text: id, description: `${item.name} — ${item.active!.description}` }
      })
  }

  function addToHistory(cmd: string) {
    history.value.unshift(cmd)
    if (history.value.length > 50) history.value.pop()
    historyIndex.value = -1
  }

  return {
    history,
    historyIndex,
    parse,
    autocomplete,
    addToHistory,
  }
}
