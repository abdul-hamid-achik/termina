import type { Command } from '~~/shared/types/commands'

/**
 * Which typed orders leave an auto-path walk (`moveTarget`) standing. ONE rule
 * for the engine (GameLoop step 1.2 cancels the walk on anything else) and the
 * client's local walk memory (GameScreen), so the two can never disagree.
 *
 * A new move replaces the destination inside the resolver; the out-of-band
 * verbs (surrender vote, talent pick, buyback) express no positional intent.
 */
const KEEPS_WALK = new Set<Command['type']>(['move', 'surrender', 'select_talent', 'buyback'])

/**
 * Item actives that put the user somewhere else (or start the recall channel a
 * hop would break) — a new positional intent, so they end the walk like any
 * other order. Every other active resolves from its own slot ahead of the
 * cycle's main action, and spending it must not cost the walk it was bought for.
 */
export const RELOCATING_ITEM_ACTIVES: ReadonlySet<string> = new Set([
  'jump_shunt',
  'shove_splice',
  'kickback_splice',
  'recall_token',
])

/** True when this typed order leaves a walk in progress standing. */
export function keepsWalk(command: Command): boolean {
  if (command.type === 'use') return !RELOCATING_ITEM_ACTIVES.has(command.item)
  return KEEPS_WALK.has(command.type)
}
