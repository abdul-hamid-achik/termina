import { ref } from 'vue'
import type { Command, TargetRef } from '~~/shared/types/commands'
import type { PlayerState, ZoneRuntimeState, TeamId } from '~~/shared/types/game'
import type { ItemDef } from '~~/shared/types/items'
import type { AbilityDef } from '~~/shared/types/hero'
import { ZONE_IDS, ZONE_MAP } from '~~/shared/constants/zones'
import { HERO_IDS, HEROES } from '~~/shared/constants/heroes'
import { TALENT_TREES } from '~~/shared/constants/talents'
import {
  BUYBACK_BASE_COST,
  BUYBACK_COST_PER_LEVEL,
  SURRENDER_MIN_TICK,
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
  /** Current game tick — enables cooldown/timing validation when provided. */
  tick?: number
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
    return { error: 'No enemy hero in your zone — target a creep (attack creep:0) or tower' }
  }
  const target = enemies.reduce((a, b) => (a.hp < b.hp ? a : b))
  return { target: `hero:${target.id}` }
}

const SHORTCUTS: Record<string, string> = {
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
  'top-lane': 'top-t1-rad',
  'mid-lane': 'mid-river',
  'bot-lane': 'bot-river',
  // Jungles
  'jg-rad': 'jungle-rad-top',
  'jg-radiant': 'jungle-rad-top',
  'jg-dire': 'jungle-dire-top',
  'jungle-rad': 'jungle-rad-top',
  'jungle-dire': 'jungle-dire-top',
  // Bases
  base: 'radiant-base',
  fountain: 'radiant-fountain',
  // Roshan
  roshan: 'roshan-pit',
  rosh: 'roshan-pit',
  // Runes
  'rune-top': 'rune-top',
  'rune-bot': 'rune-bot',
  rune: 'mid-river',
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
  if (raw.startsWith('tower:')) return { kind: 'tower', zone: raw.slice(6) }
  if (raw.startsWith('zone:')) return { kind: 'zone', zone: raw.slice(5) }
  // If it looks like a hero name without prefix, try hero
  if (HERO_IDS.includes(raw)) return { kind: 'hero', name: raw }
  return null
}

export interface ParseResult {
  command: Command | null
  error: string | null
}

function hasDebuff(player: PlayerState, type: string): boolean {
  return player.buffs.some((b) => b.id.includes(type))
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
  // Eul's Cyclone fully disables the target (mirrors the server validateAction).
  if (player.buffs.some((b) => b.id.includes('cyclone')) && command.type !== 'select_talent') {
    return 'Cannot act while cycloned'
  }

  switch (command.type) {
    case 'buyback': {
      if (player.alive) return 'Buyback is only available while dead'
      if (
        context.tick !== undefined &&
        player.buybackCooldown &&
        context.tick < player.buybackCooldown
      ) {
        return `Buyback on cooldown (${player.buybackCooldown - context.tick} ticks remaining)`
      }
      const cost = buybackCostFor(player)
      if (player.gold < cost) {
        return `Not enough gold for buyback (need ${cost - player.gold}g more)`
      }
      return null
    }
    case 'surrender': {
      if (context.tick !== undefined && context.tick < SURRENDER_MIN_TICK) {
        return `Too early to surrender (available at tick ${SURRENDER_MIN_TICK})`
      }
      return null
    }
    case 'move': {
      const zone = ZONE_MAP[player.zone]
      if (!zone) return null
      if (command.zone !== player.zone && !zone.adjacentTo.includes(command.zone)) {
        return `Too far — you move one zone per tick. From ${player.zone} you can reach: ${zone.adjacentTo.join(', ')}`
      }
      // Subset maps (one-lane / tutorial) don't contain every globally-adjacent
      // zone. Mirror the server, which also requires the destination to exist in
      // THIS game's zone set. `visibleZones` is the full game zone set (not
      // vision-filtered); skip the check until it's populated.
      const gameZones = context.visibleZones
      if (
        command.zone !== player.zone &&
        Object.keys(gameZones).length > 0 &&
        !gameZones[command.zone]
      ) {
        return `${command.zone} isn't on this map`
      }
      if (hasDebuff(player, 'root') || hasDebuff(player, 'stun')) {
        return 'Cannot move while rooted or stunned'
      }
      return null
    }
    case 'attack': {
      if (hasDebuff(player, 'stun')) return 'Cannot attack while stunned'
      const t = command.target
      if (t.kind === 'hero') {
        const target = Object.values(context.allPlayers).find(
          (p) => p.heroId === t.name || p.name.toLowerCase() === t.name.toLowerCase(),
        )
        if (target && (!target.alive || target.zone !== player.zone)) {
          return `${t.name} is not in your zone`
        }
      }
      if (t.kind === 'tower' && t.zone !== player.zone) {
        return 'Must be in the tower’s zone to attack it'
      }
      if (t.kind === 'ancient') {
        const enemyBase = player.team === 'radiant' ? 'dire-base' : 'radiant-base'
        if (player.zone !== enemyBase) {
          return `Must be in the enemy base (${enemyBase}) to attack their Mainframe`
        }
      }
      return null
    }
    case 'cast': {
      if (hasDebuff(player, 'stun')) return 'Cannot cast while stunned'
      if (hasDebuff(player, 'silence')) return 'Cannot cast while silenced'
      if (!player.heroId) return 'No hero selected'
      const hero = HEROES[player.heroId]
      if (!hero) return null
      const ability = hero.abilities[command.ability]
      if (!ability) return 'Unknown ability'
      const cd = player.cooldowns[command.ability]
      if (cd > 0) return `${ability.name} on cooldown (${cd} tick${cd === 1 ? '' : 's'})`
      if (player.mp < ability.manaCost) {
        return `Not enough mana (need ${ability.manaCost}, have ${player.mp})`
      }
      return null
    }
    case 'buy': {
      const zone = ZONE_MAP[player.zone]
      if (!zone?.shop) return 'Not in a shop zone — return to base or fountain'
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
      const zone = ZONE_MAP[player.zone]
      if (!zone?.shop) return 'Not in a shop zone — return to base or fountain'
      if (!player.items.includes(command.item)) return 'Item not owned'
      return null
    }
    case 'use': {
      if (!player.items.includes(command.item)) return 'Item not owned'
      const item = context.items?.[command.item]
      if (item && !item.active) return `${item.name} has no active ability`
      const cdBuff = player.buffs.find((b) => b.id === `item_cd_${command.item}`)
      if (cdBuff && cdBuff.ticksRemaining > 0) {
        return `Item on cooldown (${cdBuff.ticksRemaining} ticks)`
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
      if (player.level < command.tier) {
        return `Reach level ${command.tier} to choose this talent (you are level ${player.level})`
      }
      const key = `tier${command.tier}` as const
      if (player.talents[key]) return `You already chose your level ${command.tier} talent`
      return null
    }
    default:
      return null
  }
}

/**
 * Resolve a zone alias to the actual zone ID, or return the input if it's
 * already a valid zone. `base`/`fountain` are resolved relative to the player's
 * team — so a dire player typing `move base` heads to dire-base, not the enemy's.
 */
function resolveZoneAlias(zoneInput: string, team: TeamId = 'radiant'): string {
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

export function useCommands() {
  const history = ref<string[]>([])
  const historyIndex = ref(-1)

  function parse(input: string, team: TeamId = 'radiant'): ParseResult {
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
        const resolvedZone = resolveZoneAlias(zone, team)
        return { command: { type: 'move', zone: resolvedZone }, error: null }
      }

      case 'attack': {
        const targetStr = tokens[1]
        if (!targetStr)
          return {
            command: null,
            error:
              'Usage: attack <target>  (e.g. attack hero:axe, attack creep:0, attack tower:mid-t1-rad, attack ancient)',
          }
        const target = parseTarget(targetStr)
        if (!target)
          return {
            command: null,
            error: `Invalid target "${targetStr}". Use hero:<name>, creep:<index>, tower:<zone>, ancient, or self`,
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
          error: `Unknown command: ${cmd}. Try: move, attack, deny, cast, buy, sell, ward, aegis, rune, scan, status, map, chat, ping, glyph, talent, buyback, surrender`,
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
        buyback: 'Pay gold to respawn instantly (while dead)',
        surrender: "Vote to forfeit — requires 'surrender confirm'",
        talent: 'Choose a talent (levels 10/15/20/25)',
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
      // Deny only targets allied creeps in the current zone; the server enforces
      // the <50% HP rule, so here we just surface the creep:index forms.
      const partial = parts.slice(1).join(' ')
      const zoneData = context.player ? context.visibleZones[context.player.zone] : undefined
      const out: Suggestion[] = []
      if (zoneData) {
        for (let i = 0; i < zoneData.creeps.length; i++) {
          const ref = `creep:${i}`
          if (ref.includes(partial)) out.push({ text: ref, description: `Creep #${i}` })
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
      const tree = heroId ? TALENT_TREES[heroId] : undefined
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

    // First add prefix matches (higher priority)
    const prefixMatches = zonePool.filter((id) => id.startsWith(partial))
    for (const id of prefixMatches) {
      suggestions.push({ text: id, description: ZONE_MAP[id]?.name })
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
    const team = context.player?.team ?? 'radiant'
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

    // Suggest creep targets
    const zoneData = context.visibleZones[context.player.zone]
    if (zoneData) {
      for (let i = 0; i < zoneData.creeps.length; i++) {
        const ref = `creep:${i}`
        if (ref.includes(partial)) {
          suggestions.push({ text: ref, description: `Creep #${i}` })
        }
      }
    }

    // Suggest tower if present
    if (ZONE_MAP[context.player.zone]?.tower) {
      const ref = `tower:${context.player.zone}`
      if (ref.includes(partial)) {
        suggestions.push({ text: ref, description: 'Tower' })
      }
    }

    // Suggest the enemy Mainframe when standing in the enemy base
    const enemyBase = context.player.team === 'radiant' ? 'dire-base' : 'radiant-base'
    if (context.player.zone === enemyBase && 'ancient'.includes(partial)) {
      suggestions.push({ text: 'ancient', description: 'Enemy Mainframe (win the game!)' })
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
