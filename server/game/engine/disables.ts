import type { PlayerState } from '~~/shared/types/game'
import type { Command } from '~~/shared/types/commands'

/**
 * Exact debuff-id sets per debuff class. Action gating must match buff ids
 * EXACTLY — the old `b.id.includes(type)` substring match would silently
 * disable actions if a future buff id contained a debuff substring (e.g. a
 * hypothetical `stun_immune` or `post_stun_buff`). Add new debuff ids to the
 * appropriate set here as they are authored.
 */
export const DEBUFF_ID_SETS = {
  stun: new Set(['stun']),
  root: new Set(['root']),
  silence: new Set(['silence']),
  feared: new Set(['feared']),
  taunt: new Set(['taunt']),
  cyclone: new Set(['cyclone']),
  hex: new Set(['hex']),
} as const

type DebuffType = keyof typeof DEBUFF_ID_SETS

export function hasDebuff(player: PlayerState, type: DebuffType): boolean {
  // `type` is keyof typeof DEBUFF_ID_SETS, so the lookup is always defined.
  return player.buffs.some((b) => DEBUFF_ID_SETS[type].has(b.id))
}

/**
 * The disable that refuses `verb` for this hero right now, or null. The SINGLE
 * source for validateAction's disable gates (cyclone/hex stop everything;
 * Hardshell's AIRGAP acts through stun/root/silence/fear/taunt) — the bot AI
 * asks the same question before it issues an order, so the two cannot drift.
 */
export function disableBlockReason(player: PlayerState, verb: Command['type']): string | null {
  if (hasDebuff(player, 'cyclone')) return 'Cannot act while cycloned'
  if (hasDebuff(player, 'hex')) return 'Cannot act while hexed'
  const immune = player.buffs.some((b) => b.id === 'airgap')
  const held = (type: DebuffType) => !immune && hasDebuff(player, type)
  switch (verb) {
    case 'move':
      if (held('root') || held('stun')) return 'Cannot move while rooted or stunned'
      if (held('taunt')) return 'Cannot move while taunted'
      return null
    case 'attack':
      if (held('stun')) return 'Cannot attack while stunned'
      if (held('feared')) return 'Cannot attack while feared'
      // Ghost Scepter: phased out — immune to kinetic damage, but cannot attack.
      if (player.buffs.some((b) => b.id === 'ghost_form'))
        return 'Cannot attack while in ghost form'
      return null
    case 'cast':
      if (held('stun')) return 'Cannot cast while stunned'
      if (held('silence')) return 'Cannot cast while silenced'
      if (held('feared')) return 'Cannot cast while feared'
      if (held('taunt')) return 'Cannot cast while taunted'
      return null
    case 'breach':
      if (held('stun')) return 'Cannot breach while stunned'
      if (held('feared')) return 'Cannot breach while feared'
      if (held('taunt')) return 'Cannot breach while taunted'
      return null
    default:
      return null
  }
}
