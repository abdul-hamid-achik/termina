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
