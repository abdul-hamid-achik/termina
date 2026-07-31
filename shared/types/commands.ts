export type TargetRef =
  | { kind: 'hero'; name: string }
  | { kind: 'wave'; index: number }
  | { kind: 'neutral'; index: number }
  | { kind: 'ice'; zone: string }
  | { kind: 'tenant' }
  | { kind: 'terminal' }
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
  | { type: 'backup' }
  | { type: 'grab' }
  | { type: 'scan' }
  | { type: 'who' }
  | { type: 'net' }
  | { type: 'look' }
  | { type: 'status' }
  | { type: 'map' }
  | { type: 'help' }
  | { type: 'chat'; channel: 'team' | 'all'; message: string }
  | { type: 'ping'; zone: string }
  | { type: 'buyback' }
  | { type: 'surrender'; vote: 'yes' | 'no' }
  | { type: 'missing'; enemyId: string }
  | { type: 'burn'; target: { kind: 'wave'; index: number } }
  | { type: 'select_talent'; tier: 10 | 15 | 20 | 25; talentId: string }
  | { type: 'harden' }
  | { type: 'breach'; target: TargetRef }
