export interface ItemStats {
  hp?: number
  mp?: number
  attack?: number
  defense?: number
  magicResist?: number
  moveSpeed?: number
}

export interface ItemActiveDef {
  id: string
  name: string
  description: string
  cooldownTicks: number
  manaCost?: number
  /**
   * What this active targets, when it needs one. Drives client auto-targeting
   * for a bare `use <item>` (a click or shortcut) so an offensive item doesn't
   * silently reject server-side. Omitted = no target needed (self/aura cast).
   * Dual-use items (force staff, eul's, lotus) are intentionally left unset so
   * the player picks the side explicitly.
   */
  targetType?: 'enemy' | 'ally' | 'self' | 'zone'
}

export interface ItemPassiveDef {
  id: string
  name: string
  description: string
}

export interface ItemDef {
  id: string
  name: string
  cost: number
  stats: ItemStats
  active?: ItemActiveDef
  passive?: ItemPassiveDef
  buildsFrom?: string[]
  consumable: boolean
  maxStacks?: number
}

export type ItemCategoryId = 'starter' | 'attack' | 'magic' | 'defensive' | 'utility' | 'consumable'

/**
 * A thematic shop section for the items reference page. The grouping is
 * curated data (not derivable from stats — e.g. Dagon and Ethereal Blade both
 * carry attack+mp yet are Magic items) and is kept in sync with the ITEMS
 * registry by a structural test in tests/unit/shared/itemFormat.test.ts.
 */
export interface ItemCategory {
  id: ItemCategoryId
  label: string
  /** One-line teaching blurb: what this class of item is for. */
  blurb: string
  /** Item ids in this category (must partition the ITEMS registry). */
  ids: string[]
}
