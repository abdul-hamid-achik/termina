export type ZoneType = 'base' | 'fountain' | 'lane' | 'jungle' | 'river' | 'objective'

/** Tower tier (1 = outermost, 3 = innermost, 4 = base/ranged). Undefined = no tower. */
export type TowerTier = 1 | 2 | 3 | 4

/** Lane identifier for tower-bearing zones. Undefined = non-lane zone. */
export type Lane = 'top' | 'mid' | 'bot'

export interface Zone {
  id: string
  name: string
  type: ZoneType
  adjacentTo: string[]
  team: 'radiant' | 'dire' | 'neutral'
  tower: boolean
  shop: boolean
  /** Tower tier — required when `tower` is true. Absent on non-tower zones. */
  tier?: TowerTier
  /** Lane the zone belongs to — present on lane/tower zones. */
  lane?: Lane
}
