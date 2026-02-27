export type TargetRef =
  | { kind: 'hero'; name: string }
  | { kind: 'creep'; index: number }
  | { kind: 'tower'; zone: string }
  | { kind: 'self' }

export type Command =
  | { type: 'move'; zone: string }
  | { type: 'attack'; target: TargetRef }
  | { type: 'cast'; ability: 'q' | 'w' | 'e' | 'r'; target?: TargetRef }
  | { type: 'use'; item: string; target?: TargetRef | string }
  | { type: 'buy'; item: string }
  | { type: 'sell'; item: string }
  | { type: 'ward'; zone: string }
  | { type: 'scan' }
  | { type: 'status' }
  | { type: 'map' }
  | { type: 'chat'; channel: 'team' | 'all'; message: string }
  | { type: 'ping'; zone: string }
