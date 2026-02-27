export type ZoneType = 'base' | 'fountain' | 'lane' | 'jungle' | 'river' | 'objective'

export interface Zone {
  id: string
  name: string
  type: ZoneType
  adjacentTo: string[]
  team: 'radiant' | 'dire' | 'neutral'
  tower: boolean
  shop: boolean
}
