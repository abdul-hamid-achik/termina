import { describe, it, expect } from 'vitest'
import { keepsWalk, RELOCATING_ITEM_ACTIVES } from '~~/shared/utils/standingOrders'

describe('keepsWalk — which typed orders leave an auto-path walk standing', () => {
  it('a move and the out-of-band verbs keep it', () => {
    expect(keepsWalk({ type: 'move', zone: 'coldstore-cross' })).toBe(true)
    expect(keepsWalk({ type: 'surrender' } as never)).toBe(true)
    expect(keepsWalk({ type: 'buyback' } as never)).toBe(true)
    expect(keepsWalk({ type: 'select_talent', tier: 10, talentId: 'left' } as never)).toBe(true)
  })

  it('an item active keeps it — it resolves from its own slot', () => {
    expect(keepsWalk({ type: 'use', item: 'hardshell' })).toBe(true)
    expect(keepsWalk({ type: 'use', item: 'trauma_patch' })).toBe(true)
  })

  it('an item active that relocates you (or starts the recall channel) ends it', () => {
    for (const item of RELOCATING_ITEM_ACTIVES) {
      expect(keepsWalk({ type: 'use', item })).toBe(false)
    }
    expect([...RELOCATING_ITEM_ACTIVES].sort()).toEqual([
      'jump_shunt',
      'kickback_splice',
      'recall_token',
      'shove_splice',
    ])
  })

  it('any other deliberate order ends it', () => {
    expect(keepsWalk({ type: 'attack', target: { kind: 'wave', index: 0 } })).toBe(false)
    expect(keepsWalk({ type: 'cast', ability: 'q' } as never)).toBe(false)
    expect(keepsWalk({ type: 'buy', item: 'edge_kit' } as never)).toBe(false)
  })
})
