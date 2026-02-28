import { ref } from 'vue'
import type { Command, TargetRef } from '~~/shared/types/commands'
import type { PlayerState, ZoneRuntimeState } from '~~/shared/types/game'
import { ZONE_IDS, ZONE_MAP } from '~~/shared/constants/zones'
import { HERO_IDS } from '~~/shared/constants/heroes'

export interface Suggestion {
  text: string
  description?: string
}

export interface GameContext {
  player: PlayerState | null
  visibleZones: Record<string, ZoneRuntimeState>
  allPlayers: Record<string, PlayerState>
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

function parseTarget(raw: string): TargetRef | null {
  if (raw === 'self') return { kind: 'self' }
  if (raw.startsWith('hero:')) return { kind: 'hero', name: raw.slice(5) }
  if (raw.startsWith('creep:')) {
    const idx = Number.parseInt(raw.slice(6), 10)
    if (!Number.isNaN(idx)) return { kind: 'creep', index: idx }
  }
  if (raw.startsWith('tower:')) return { kind: 'tower', zone: raw.slice(6) }
  // If it looks like a hero name without prefix, try hero
  if (HERO_IDS.includes(raw)) return { kind: 'hero', name: raw }
  return null
}

export interface ParseResult {
  command: Command | null
  error: string | null
}

export function useCommands() {
  const history = ref<string[]>([])
  const historyIndex = ref(-1)

  function parse(input: string): ParseResult {
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
        return { command: { type: 'move', zone }, error: null }
      }

      case 'attack': {
        const targetStr = tokens[1]
        if (!targetStr) return { command: null, error: 'Usage: attack <target>  (e.g. attack hero:axe, attack creep:0, attack tower:mid-t1-rad)' }
        const target = parseTarget(targetStr)
        if (!target) return { command: null, error: `Invalid target "${targetStr}". Use hero:<name>, creep:<index>, tower:<zone>, or self` }
        return { command: { type: 'attack', target }, error: null }
      }

      case 'cast': {
        const ability = tokens[1] as 'q' | 'w' | 'e' | 'r'
        if (!['q', 'w', 'e', 'r'].includes(ability)) return { command: null, error: 'Usage: cast <q|w|e|r> [target]' }
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
        return { command: { type: 'ward', zone }, error: null }
      }

      case 'scan':
        return { command: { type: 'scan' }, error: null }

      case 'status':
        return { command: { type: 'status' }, error: null }

      case 'map':
        return { command: { type: 'map' }, error: null }

      case 'chat': {
        const channel = tokens[1] as 'team' | 'all'
        if (!['team', 'all'].includes(channel)) return { command: null, error: 'Usage: chat <team|all> <message>' }
        const message = tokens.slice(2).join(' ')
        if (!message) return { command: null, error: 'Usage: chat <team|all> <message>' }
        return { command: { type: 'chat', channel, message }, error: null }
      }

      case 'ping': {
        const zone = tokens[1]
        if (!zone) return { command: null, error: 'Usage: ping <zone>' }
        return { command: { type: 'ping', zone }, error: null }
      }

      default:
        return { command: null, error: `Unknown command: ${cmd}. Try: move, attack, cast, buy, sell, ward, scan, status, map, chat, ping` }
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
        'cast',
        'use',
        'buy',
        'sell',
        'ward',
        'scan',
        'status',
        'map',
        'chat',
        'ping',
      ]
      const shortcuts = Object.keys(SHORTCUTS)
      const all = [...cmds, ...shortcuts]
      return all
        .filter((c) => c.startsWith(parts[0]!))
        .map((c) => ({ text: c, description: SHORTCUTS[c] ? `→ ${SHORTCUTS[c]}` : undefined }))
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
      // No items constant yet, suggest placeholder
      return []
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

    return []
  }

  function _suggestZones(partial: string, context: GameContext): Suggestion[] {
    const visibleIds = Object.keys(context.visibleZones)
    const zonePool = visibleIds.length > 0 ? visibleIds : ZONE_IDS
    return zonePool
      .filter((id) => id.includes(partial))
      .slice(0, 10)
      .map((id) => ({ text: id, description: ZONE_MAP[id]?.name }))
  }

  function _suggestAdjacentZones(partial: string, context: GameContext): Suggestion[] {
    if (!context.player) return _suggestZones(partial, context)
    const zone = ZONE_MAP[context.player.zone]
    if (!zone) return []
    return zone.adjacentTo
      .filter((id) => id.includes(partial))
      .map((id) => ({ text: id, description: ZONE_MAP[id]?.name }))
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

    // Suggest self
    if ('self'.includes(partial)) {
      suggestions.push({ text: 'self', description: 'Self-target' })
    }

    return suggestions.slice(0, 10)
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
