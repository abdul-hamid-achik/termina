import { describe, it, expect } from 'vitest'
import { useCommands, type GameContext } from '../../../app/composables/useCommands'
import type { PlayerState } from '../../../shared/types/game'

// ── Helpers ───────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-t1-rad',
    hp: 500,
    maxHp: 550,
    mp: 200,
    maxMp: 280,
    level: 3,
    xp: 150,
    gold: 300,
    items: ['boots', null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    ...overrides,
  }
}

function makeContext(overrides: Partial<GameContext> = {}): GameContext {
  return {
    player: makePlayer(),
    visibleZones: {
      'mid-t1-rad': { id: 'mid-t1-rad', wards: [], creeps: ['c0', 'c1'] },
    },
    allPlayers: {
      p1: makePlayer(),
      e1: makePlayer({
        id: 'e1',
        name: 'Enemy',
        heroId: 'daemon',
        team: 'dire',
        zone: 'mid-t1-rad',
        alive: true,
      }),
    },
    ...overrides,
  }
}

// ── Parse Tests ───────────────────────────────────────────────────

describe('useCommands', () => {
  describe('parse', () => {
    describe('move command', () => {
      it('parses basic move', () => {
        const { parse } = useCommands()
        const result = parse('move mid-river')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'move', zone: 'mid-river' })
      })

      it('returns error without zone arg', () => {
        const { parse } = useCommands()
        const result = parse('move')

        expect(result.command).toBeNull()
        expect(result.error).toBe('Usage: move <zone>')
      })
    })

    describe('attack command', () => {
      it('parses attack hero target', () => {
        const { parse } = useCommands()
        const result = parse('attack hero:daemon')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'hero', name: 'daemon' },
        })
      })

      it('parses attack creep target', () => {
        const { parse } = useCommands()
        const result = parse('attack creep:2')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'creep', index: 2 },
        })
      })

      it('parses attack tower target', () => {
        const { parse } = useCommands()
        const result = parse('attack tower:mid-t1-rad')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'tower', zone: 'mid-t1-rad' },
        })
      })

      it('parses attack self target', () => {
        const { parse } = useCommands()
        const result = parse('attack self')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'self' },
        })
      })

      it('parses bare hero name as hero target', () => {
        const { parse } = useCommands()
        const result = parse('attack echo')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'hero', name: 'echo' },
        })
      })

      it('returns error for invalid target', () => {
        const { parse } = useCommands()
        const result = parse('attack xyz_invalid')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Invalid target')
      })

      it('returns error without target', () => {
        const { parse } = useCommands()
        const result = parse('attack')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: attack')
      })
    })

    describe('cast command', () => {
      it('parses cast with ability slot', () => {
        const { parse } = useCommands()

        for (const slot of ['q', 'w', 'e', 'r']) {
          const result = parse(`cast ${slot}`)
          expect(result.error).toBeNull()
          expect(result.command).toEqual({ type: 'cast', ability: slot, target: undefined })
        }
      })

      it('parses cast with target', () => {
        const { parse } = useCommands()
        const result = parse('cast q hero:echo')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'cast',
          ability: 'q',
          target: { kind: 'hero', name: 'echo' },
        })
      })

      it('returns error for invalid ability slot', () => {
        const { parse } = useCommands()
        const result = parse('cast x')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: cast')
      })

      it('returns error without ability', () => {
        const { parse } = useCommands()
        const result = parse('cast')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: cast')
      })
    })

    describe('use command', () => {
      it('parses use item without target', () => {
        const { parse } = useCommands()
        const result = parse('use boots')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'use', item: 'boots', target: undefined })
      })

      it('parses use item with hero target', () => {
        const { parse } = useCommands()
        const result = parse('use heal hero:echo')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'use',
          item: 'heal',
          target: { kind: 'hero', name: 'echo' },
        })
      })

      it('parses use item with non-parseable target as string', () => {
        const { parse } = useCommands()
        const result = parse('use potion xyz_target')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'use', item: 'potion', target: 'xyz_target' })
      })

      it('returns error without item', () => {
        const { parse } = useCommands()
        const result = parse('use')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: use')
      })
    })

    describe('buy command', () => {
      it('parses buy item', () => {
        const { parse } = useCommands()
        const result = parse('buy boots')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'buy', item: 'boots' })
      })

      it('returns error without item', () => {
        const { parse } = useCommands()
        const result = parse('buy')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: buy')
      })
    })

    describe('sell command', () => {
      it('parses sell item', () => {
        const { parse } = useCommands()
        const result = parse('sell boots')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'sell', item: 'boots' })
      })

      it('returns error without item', () => {
        const { parse } = useCommands()
        const result = parse('sell')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: sell')
      })
    })

    describe('ward command', () => {
      it('parses ward zone', () => {
        const { parse } = useCommands()
        const result = parse('ward mid-river')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'ward', zone: 'mid-river' })
      })

      it('returns error without zone', () => {
        const { parse } = useCommands()
        const result = parse('ward')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: ward')
      })
    })

    describe('scan command', () => {
      it('parses scan', () => {
        const { parse } = useCommands()
        const result = parse('scan')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'scan' })
      })
    })

    describe('status command', () => {
      it('parses status', () => {
        const { parse } = useCommands()
        const result = parse('status')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'status' })
      })
    })

    describe('map command', () => {
      it('parses map', () => {
        const { parse } = useCommands()
        const result = parse('map')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'map' })
      })
    })

    describe('chat command', () => {
      it('parses team chat', () => {
        const { parse } = useCommands()
        const result = parse('chat team Hello everyone')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'chat',
          channel: 'team',
          message: 'hello everyone',
        })
      })

      it('parses all chat', () => {
        const { parse } = useCommands()
        const result = parse('chat all gg wp')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'chat',
          channel: 'all',
          message: 'gg wp',
        })
      })

      it('returns error for invalid channel', () => {
        const { parse } = useCommands()
        const result = parse('chat private hello')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: chat')
      })

      it('returns error without message', () => {
        const { parse } = useCommands()
        const result = parse('chat team')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: chat')
      })
    })

    describe('ping command', () => {
      it('parses ping zone', () => {
        const { parse } = useCommands()
        const result = parse('ping mid-river')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'ping', zone: 'mid-river' })
      })

      it('returns error without zone', () => {
        const { parse } = useCommands()
        const result = parse('ping')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: ping')
      })
    })

    describe('unknown command', () => {
      it('returns error for unknown command', () => {
        const { parse } = useCommands()
        const result = parse('dance')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Unknown command: dance')
      })
    })

    describe('edge cases', () => {
      it('returns null for empty input', () => {
        const { parse } = useCommands()
        const result = parse('')

        expect(result.command).toBeNull()
        expect(result.error).toBeNull()
      })

      it('returns null for whitespace-only input', () => {
        const { parse } = useCommands()
        const result = parse('   ')

        expect(result.command).toBeNull()
        expect(result.error).toBeNull()
      })

      it('handles extra whitespace in commands', () => {
        const { parse } = useCommands()
        const result = parse('  move   mid-river  ')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'move', zone: 'mid-river' })
      })

      it('normalizes input to lowercase', () => {
        const { parse } = useCommands()
        const result = parse('MOVE Mid-River')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'move', zone: 'mid-river' })
      })
    })
  })

  describe('shortcuts', () => {
    it('expands mv → move', () => {
      const { parse } = useCommands()
      const result = parse('mv mid-river')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({ type: 'move', zone: 'mid-river' })
    })

    it('expands atk → attack', () => {
      const { parse } = useCommands()
      const result = parse('atk hero:echo')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({
        type: 'attack',
        target: { kind: 'hero', name: 'echo' },
      })
    })

    it('expands q → cast q', () => {
      const { parse } = useCommands()
      const result = parse('q hero:daemon')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'hero', name: 'daemon' },
      })
    })

    it('expands w → cast w', () => {
      const { parse } = useCommands()
      const result = parse('w')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({ type: 'cast', ability: 'w', target: undefined })
    })

    it('expands e → cast e', () => {
      const { parse } = useCommands()
      const result = parse('e self')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({
        type: 'cast',
        ability: 'e',
        target: { kind: 'self' },
      })
    })

    it('expands r → cast r', () => {
      const { parse } = useCommands()
      const result = parse('r hero:kernel')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({
        type: 'cast',
        ability: 'r',
        target: { kind: 'hero', name: 'kernel' },
      })
    })

    it('expands b → buy', () => {
      const { parse } = useCommands()
      const result = parse('b boots')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({ type: 'buy', item: 'boots' })
    })

    it('shortcut q without target works', () => {
      const { parse } = useCommands()
      const result = parse('q')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({ type: 'cast', ability: 'q', target: undefined })
    })
  })

  describe('target parsing', () => {
    it('parses hero:name target', () => {
      const { parse } = useCommands()
      const result = parse('attack hero:sentry')

      expect(result.command).toEqual({
        type: 'attack',
        target: { kind: 'hero', name: 'sentry' },
      })
    })

    it('parses creep:index target', () => {
      const { parse } = useCommands()
      const result = parse('attack creep:0')

      expect(result.command).toEqual({
        type: 'attack',
        target: { kind: 'creep', index: 0 },
      })
    })

    it('parses tower:zone target', () => {
      const { parse } = useCommands()
      const result = parse('attack tower:top-t1-rad')

      expect(result.command).toEqual({
        type: 'attack',
        target: { kind: 'tower', zone: 'top-t1-rad' },
      })
    })

    it('parses self target', () => {
      const { parse } = useCommands()
      const result = parse('cast q self')

      expect(result.command).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'self' },
      })
    })

    it('parses bare hero name from HERO_IDS', () => {
      const { parse } = useCommands()
      const result = parse('attack kernel')

      expect(result.command).toEqual({
        type: 'attack',
        target: { kind: 'hero', name: 'kernel' },
      })
    })

    it('rejects invalid creep index', () => {
      const { parse } = useCommands()
      const result = parse('attack creep:abc')

      expect(result.command).toBeNull()
      expect(result.error).toContain('Invalid target')
    })
  })

  describe('autocomplete', () => {
    describe('command completion', () => {
      it('suggests commands starting with partial input', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('m', context)

        const texts = suggestions.map(s => s.text)
        expect(texts).toContain('move')
        expect(texts).toContain('map')
        expect(texts).toContain('mv')
      })

      it('suggests commands and shortcuts for "a"', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('a', context)

        const texts = suggestions.map(s => s.text)
        expect(texts).toContain('attack')
        expect(texts).toContain('atk')
      })

      it('returns empty for empty input', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('', context)

        expect(suggestions).toEqual([])
      })

      it('includes shortcut description', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('mv', context)

        const mv = suggestions.find(s => s.text === 'mv')
        expect(mv?.description).toBe('→ move')
      })
    })

    describe('zone completion for move', () => {
      it('suggests zones matching partial', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('move mid', context)

        const texts = suggestions.map(s => s.text)
        expect(texts.some(t => t.includes('mid'))).toBe(true)
      })

      it('suggests visible zones when available', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          visibleZones: {
            'mid-t1-rad': { id: 'mid-t1-rad', wards: [], creeps: [] },
            'mid-river': { id: 'mid-river', wards: [], creeps: [] },
          },
        })

        const suggestions = autocomplete('move mid', context)
        const texts = suggestions.map(s => s.text)

        expect(texts).toContain('mid-t1-rad')
        expect(texts).toContain('mid-river')
      })
    })

    describe('target completion for attack', () => {
      it('suggests enemy heroes in the same zone', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('attack hero', context)

        const texts = suggestions.map(s => s.text)
        expect(texts.some(t => t.includes('daemon'))).toBe(true)
      })

      it('suggests creep targets', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('attack creep', context)

        const texts = suggestions.map(s => s.text)
        expect(texts).toContain('creep:0')
        expect(texts).toContain('creep:1')
      })

      it('suggests self target', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('attack s', context)

        const texts = suggestions.map(s => s.text)
        expect(texts).toContain('self')
      })

      it('returns empty when no player context', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({ player: null })
        const suggestions = autocomplete('attack h', context)

        expect(suggestions).toEqual([])
      })
    })

    describe('cast ability completion', () => {
      it('suggests all ability slots when partial matches', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        // "cast q" has parts.length === 2, expandedTokens.length === 1
        // so it suggests ability slots starting with 'q'
        const suggestions = autocomplete('cast q', context)

        const texts = suggestions.map(s => s.text)
        expect(texts).toContain('cast q')
      })

      it('filters ability slots by partial', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('cast r', context)

        const texts = suggestions.map(s => s.text)
        expect(texts).toContain('cast r')
        expect(texts).not.toContain('cast q')
      })
    })

    describe('chat channel completion', () => {
      it('suggests team channel', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('chat t', context)

        const texts = suggestions.map(s => s.text)
        expect(texts).toContain('chat team')
      })

      it('suggests all channel', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('chat a', context)

        const texts = suggestions.map(s => s.text)
        expect(texts).toContain('chat all')
        expect(texts).not.toContain('chat team')
      })
    })

    describe('ping zone completion', () => {
      it('suggests zones for ping', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('ping mid', context)

        const texts = suggestions.map(s => s.text)
        expect(texts.some(t => t.includes('mid'))).toBe(true)
      })
    })

    describe('ward zone completion', () => {
      it('suggests adjacent zones for ward', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ zone: 'mid-t1-rad' }),
        })
        const suggestions = autocomplete('ward mid', context)

        const texts = suggestions.map(s => s.text)
        // mid-t1-rad is adjacent to mid-t2-rad and mid-river
        expect(texts.some(t => t.includes('mid'))).toBe(true)
      })

      it('falls back to all zones when no player', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({ player: null })
        const suggestions = autocomplete('ward mid', context)

        expect(suggestions.length).toBeGreaterThan(0)
      })
    })
  })

  describe('command history', () => {
    it('tracks command history', () => {
      const { history, addToHistory } = useCommands()

      addToHistory('move mid-river')
      addToHistory('attack hero:echo')

      expect(history.value).toEqual(['attack hero:echo', 'move mid-river'])
    })

    it('caps history at 50 entries', () => {
      const { history, addToHistory } = useCommands()

      for (let i = 0; i < 60; i++) {
        addToHistory(`command ${i}`)
      }

      expect(history.value).toHaveLength(50)
      // Most recent is first
      expect(history.value[0]).toBe('command 59')
    })

    it('resets historyIndex on add', () => {
      const { historyIndex, addToHistory } = useCommands()

      historyIndex.value = 3
      addToHistory('move top-river')

      expect(historyIndex.value).toBe(-1)
    })
  })
})
