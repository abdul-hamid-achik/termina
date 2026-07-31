import type {
  ItemDef,
  ItemStats,
  ItemActiveDef,
  ItemCategory,
  ItemCategoryId,
} from '~~/shared/types/items'
import { WAVE_SCRIP_MIN, WAVE_SCRIP_MAX } from '~~/shared/constants/balance'

/**
 * Pure, human-readable formatting + aggregation of item data for the items
 * reference page (/items) and its components. Kept in shared/ so the page, the
 * ItemCard/LoadoutSummary components and unit tests all use one source of truth
 * — the in-game shop duplicates a raw `+${val} ${key}` stat line in two
 * components; this is the humanized, single-owner version.
 */

/** Display labels for stat keys (raw camelCase → readable). */
export const STAT_LABELS: Record<keyof ItemStats, string> = {
  integ: 'INTEG',
  bw: 'BW',
  attack: 'Attack',
  plate: 'Plate',
  ice: 'Ice',
}

// Stable display order so stat lines read consistently across items.
const STAT_ORDER: (keyof ItemStats)[] = ['integ', 'bw', 'attack', 'plate', 'ice']

/** `["+250 INTEG", "+5 Plate"]` style stat lines; empty array if statless. */
export function formatStats(stats: ItemStats): string[] {
  return STAT_ORDER.filter((k) => stats[k]).map((k) => `+${stats[k]} ${STAT_LABELS[k]}`)
}

/** Sum the stat blocks of a list of items into one aggregate. */
export function aggregateStats(items: ItemDef[]): ItemStats {
  const total: ItemStats = {}
  for (const it of items) {
    for (const k of STAT_ORDER) {
      const v = it.stats[k]
      if (v) total[k] = (total[k] ?? 0) + v
    }
  }
  return total
}

/** Total scrip cost of a list of items. */
export function totalCost(items: ItemDef[]): number {
  return items.reduce((sum, it) => sum + it.cost, 0)
}

/** Average scrip from one wave last-hit (the in-game bounty range midpoint). */
const AVG_WAVE_SCRIP = (WAVE_SCRIP_MIN + WAVE_SCRIP_MAX) / 2

/**
 * Roughly how many wave last-hits a scrip amount represents — makes an abstract
 * build cost tangible for a newcomer ("this build ≈ N last-hits") and teaches
 * that last-hitting is how items get funded. Uses the average wave bounty.
 */
export function lastHitsToAfford(scrip: number): number {
  if (scrip <= 0) return 0
  return Math.ceil(scrip / AVG_WAVE_SCRIP)
}

/** Item active cooldown in whole seconds (0 ⇒ no cooldown), given the 4s batch clock ms. */
export function activeCooldownSeconds(active: ItemActiveDef, tickMs: number): number {
  return Math.round((active.cooldownCycles * tickMs) / 1000)
}

/** Sort a list of items by cost ascending (stable on equal cost via name). */
export function byCostAscending(items: ItemDef[]): ItemDef[] {
  return [...items].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name))
}

export interface BrowseSection {
  id: ItemCategoryId
  label: string
  blurb: string
  items: ItemDef[]
}

/**
 * Resolve the visible item-browser sections for the /items page: keep the
 * selected category (or all), resolve ids to items, filter by a name search,
 * sort each section cheapest-first, and drop sections left empty. Pure so the
 * page's filter/search behavior is unit-tested.
 */
export function browseSections(
  categories: ItemCategory[],
  itemsById: Record<string, ItemDef>,
  activeCategory: ItemCategoryId | 'all',
  search: string,
): BrowseSection[] {
  const q = search.trim().toLowerCase()
  return categories
    .filter((c) => activeCategory === 'all' || c.id === activeCategory)
    .map((c) => ({
      id: c.id,
      label: c.label,
      blurb: c.blurb,
      items: byCostAscending(
        c.ids
          .map((id) => itemsById[id])
          .filter((it): it is ItemDef => !!it && (!q || it.name.toLowerCase().includes(q))),
      ),
    }))
    .filter((c) => c.items.length > 0)
}
