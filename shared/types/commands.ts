export type TargetRef =
  | { kind: 'hero'; name: string }
  | { kind: 'creep'; index: number }
  | { kind: 'neutral'; index: number }
  | { kind: 'tower'; zone: string }
  | { kind: 'roshan' }
  | { kind: 'zone'; zone: string }
  | { kind: 'self' }

export type Command =
  | { type: 'move'; zone: string }
  | { type: 'attack'; target: TargetRef }
  | { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r'; target?: TargetRef }
  | { type: 'use'; item: string; target?: TargetRef | string }
  | { type: 'buy'; item: string }
  | { type: 'sell'; item: string }
  | { type: 'ward'; zone: string }
  | { type: 'aegis' }
  | { type: 'rune' }
  | { type: 'scan' }
  | { type: 'status' }
  | { type: 'map' }
  | { type: 'chat'; channel: 'team' | 'all'; message: string }
  | { type: 'ping'; zone: string }
  | { type: 'buyback' }
  | { type: 'surrender'; vote: 'yes' | 'no' }
  | { type: 'missing'; enemyId: string }
  | { type: 'deny'; target: { kind: 'creep'; index: number } }
  | { type: 'select_talent'; tier: 10 | 15 | 20 | 25; talentId: string }
  | { type: 'glyph' }
