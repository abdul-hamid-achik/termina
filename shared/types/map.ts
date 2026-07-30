export type ZoneType = 'base' | 'fountain' | 'lane' | 'jungle' | 'river' | 'objective'

/** Ice tier (1 = outermost, 3 = innermost, 4 = base/ranged). Undefined = no ice. */
export type IceTier = 1 | 2 | 3 | 4

/** Lane identifier for ice-bearing zones. Undefined = non-lane zone. */
export type Lane = 'top' | 'mid' | 'bot'

export interface Zone {
  id: string
  name: string
  type: ZoneType
  adjacentTo: string[]
  team: 'chaff' | 'audit' | 'neutral'
  ice: boolean
  shop: boolean
  /** Ice tier — required when `ice` is true. Absent on non-ice zones. */
  tier?: IceTier
  /** Lane the zone belongs to — present on lane/ice zones. */
  lane?: Lane
}
