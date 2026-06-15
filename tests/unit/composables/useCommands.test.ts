import { describe, it, expect } from 'vitest'
import {
  useCommands,
  validateCommand,
  buybackCostFor,
  pickAbilityTargetString,
  type GameContext,
} from '../../../app/composables/useCommands'
import type { PlayerState } from '../../../shared/types/game'
import type { ItemDef } from '../../../shared/types/items'
import type { AbilityDef, AbilityEffect } from '../../../shared/types/hero'

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
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
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

    describe('buyback command', () => {
      it('parses buyback', () => {
        const { parse } = useCommands()
        const result = parse('buyback')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'buyback' })
      })
    })

    describe('talent command', () => {
      it('parses a tier + side into a select_talent command', () => {
        const { parse } = useCommands()
        const result = parse('talent 10 left')

        expect(result.error).toBeNull()
        // left/right are resolved to the hero's talentId later (GameScreen);
        // parse keeps the side keyword since it has no hero context.
        expect(result.command).toEqual({ type: 'select_talent', tier: 10, talentId: 'left' })
      })

      it('accepts every valid tier', () => {
        const { parse } = useCommands()
        for (const tier of [10, 15, 20, 25] as const) {
          const result = parse(`talent ${tier} right`)
          expect(result.command).toEqual({ type: 'select_talent', tier, talentId: 'right' })
        }
      })

      it('passes a full talentId through unchanged', () => {
        const { parse } = useCommands()
        const result = parse('talent 15 echo_15_left')
        expect(result.command).toEqual({
          type: 'select_talent',
          tier: 15,
          talentId: 'echo_15_left',
        })
      })

      it('rejects an invalid tier', () => {
        const { parse } = useCommands()
        const result = parse('talent 12 left')
        expect(result.command).toBeNull()
        expect(result.error).toContain('10|15|20|25')
      })

      it('requires a choice', () => {
        const { parse } = useCommands()
        const result = parse('talent 10')
        expect(result.command).toBeNull()
        expect(result.error).toContain('left|right')
      })
    })

    describe('surrender command', () => {
      it('requires confirmation when bare', () => {
        const { parse } = useCommands()
        const result = parse('surrender')

        expect(result.command).toBeNull()
        expect(result.error).toContain('surrender confirm')
      })

      it('parses surrender confirm as a yes vote', () => {
        const { parse } = useCommands()
        const result = parse('surrender confirm')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'surrender', vote: 'yes' })
      })

      it('parses surrender yes as a yes vote', () => {
        const { parse } = useCommands()
        const result = parse('surrender yes')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'surrender', vote: 'yes' })
      })

      it('parses surrender cancel as a no vote', () => {
        const { parse } = useCommands()
        const result = parse('surrender cancel')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'surrender', vote: 'no' })
      })

      it('parses surrender no as a no vote', () => {
        const { parse } = useCommands()
        const result = parse('surrender no')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'surrender', vote: 'no' })
      })

      it('rejects unknown surrender argument', () => {
        const { parse } = useCommands()
        const result = parse('surrender maybe')

        expect(result.command).toBeNull()
        expect(result.error).toContain('surrender confirm')
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

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('move')
        expect(texts).toContain('map')
        expect(texts).toContain('mv')
      })

      it('suggests commands and shortcuts for "a"', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('a', context)

        const texts = suggestions.map((s) => s.text)
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

        const mv = suggestions.find((s) => s.text === 'mv')
        expect(mv?.description).toBe('→ move')
      })

      it('suggests buyback for "buy" prefix', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('buy', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('buy')
        expect(texts).toContain('buyback')
      })

      it('suggests surrender with description', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('surr', context)

        const surrender = suggestions.find((s) => s.text === 'surrender')
        expect(surrender).toBeDefined()
        expect(surrender!.description).toContain('confirm')
      })
    })

    describe('surrender confirmation completion', () => {
      it('suggests confirm and cancel', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('surrender c', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('surrender confirm')
        expect(texts).toContain('surrender cancel')
      })

      it('filters by partial argument', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('surrender co', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('surrender confirm')
        expect(texts).not.toContain('surrender cancel')
      })
    })

    describe('zone completion for move', () => {
      it('suggests zones matching partial', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('move mid', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts.some((t) => t.includes('mid'))).toBe(true)
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
        const texts = suggestions.map((s) => s.text)

        expect(texts).toContain('mid-t1-rad')
        expect(texts).toContain('mid-river')
      })
    })

    describe('target completion for attack', () => {
      it('suggests enemy heroes in the same zone', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('attack hero', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts.some((t) => t.includes('daemon'))).toBe(true)
      })

      it('suggests creep targets', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('attack creep', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('creep:0')
        expect(texts).toContain('creep:1')
      })

      it('suggests self target', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('attack s', context)

        const texts = suggestions.map((s) => s.text)
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

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('cast q')
      })

      it('filters ability slots by partial', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('cast r', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('cast r')
        expect(texts).not.toContain('cast q')
      })
    })

    describe('chat channel completion', () => {
      it('suggests team channel', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('chat t', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('chat team')
      })

      it('suggests all channel', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('chat a', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts).toContain('chat all')
        expect(texts).not.toContain('chat team')
      })
    })

    describe('ping zone completion', () => {
      it('suggests zones for ping', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('ping mid', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts.some((t) => t.includes('mid'))).toBe(true)
      })
    })

    describe('buy item completion', () => {
      const sampleItems: Record<string, ItemDef> = {
        healing_salve: {
          id: 'healing_salve',
          name: 'Healing Salve',
          cost: 150,
          stats: {},
          consumable: true,
          maxStacks: 3,
          active: {
            id: 'healing_salve_active',
            name: 'Heal',
            description: 'Restore HP',
            cooldownTicks: 0,
          },
        },
        boots_of_speed: {
          id: 'boots_of_speed',
          name: 'Boots of Speed',
          cost: 500,
          stats: { moveSpeed: 1 },
          consumable: false,
        },
        blink_module: {
          id: 'blink_module',
          name: 'Blink Module',
          cost: 2150,
          stats: { attack: 10 },
          consumable: false,
          active: {
            id: 'blink_active',
            name: 'Blink',
            description: 'Teleport to adjacent zone',
            cooldownTicks: 12,
          },
        },
      }

      it('returns items matching partial with cost in description', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({ items: sampleItems })
        const suggestions = autocomplete('buy heal', context)

        expect(suggestions.length).toBeGreaterThan(0)
        const salve = suggestions.find((s) => s.text === 'healing_salve')
        expect(salve).toBeDefined()
        expect(salve!.description).toContain('150g')
      })

      it('shows [affordable] when player has enough gold', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ gold: 300 }),
          items: sampleItems,
        })
        const suggestions = autocomplete('buy heal', context)
        const salve = suggestions.find((s) => s.text === 'healing_salve')

        expect(salve).toBeDefined()
        expect(salve!.description).toContain('[affordable]')
      })

      it('shows gold needed when player cannot afford', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ gold: 100 }),
          items: sampleItems,
        })
        const suggestions = autocomplete('buy boots', context)
        const boots = suggestions.find((s) => s.text === 'boots_of_speed')

        expect(boots).toBeDefined()
        expect(boots!.description).toContain('[need 400g]')
      })

      it('returns empty when no items in context', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('buy heal', context)

        expect(suggestions).toEqual([])
      })
    })

    describe('sell item completion', () => {
      const sampleItems: Record<string, ItemDef> = {
        boots_of_speed: {
          id: 'boots_of_speed',
          name: 'Boots of Speed',
          cost: 500,
          stats: { moveSpeed: 1 },
          consumable: false,
        },
        healing_salve: {
          id: 'healing_salve',
          name: 'Healing Salve',
          cost: 150,
          stats: {},
          consumable: true,
          maxStacks: 3,
          active: {
            id: 'healing_salve_active',
            name: 'Heal',
            description: 'Restore HP',
            cooldownTicks: 0,
          },
        },
        blink_module: {
          id: 'blink_module',
          name: 'Blink Module',
          cost: 2150,
          stats: { attack: 10 },
          consumable: false,
          active: { id: 'blink_active', name: 'Blink', description: 'Teleport', cooldownTicks: 12 },
        },
      }

      it('suggests only owned items matching partial', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({
            items: ['boots_of_speed', 'healing_salve', null, null, null, null],
          }),
          items: sampleItems,
        })
        const suggestions = autocomplete('sell boots', context)
        const texts = suggestions.map((s) => s.text)

        expect(texts).toContain('boots_of_speed')
        expect(texts).not.toContain('blink_module')
      })

      it('includes sell price in description', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ items: ['boots_of_speed', null, null, null, null, null] }),
          items: sampleItems,
        })
        const suggestions = autocomplete('sell boots', context)
        const boots = suggestions.find((s) => s.text === 'boots_of_speed')

        expect(boots).toBeDefined()
        expect(boots!.description).toContain('sell: 250g')
      })

      it('returns empty when no items in context', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('sell boots', context)

        expect(suggestions).toEqual([])
      })
    })

    describe('use item completion', () => {
      const sampleItems: Record<string, ItemDef> = {
        boots_of_speed: {
          id: 'boots_of_speed',
          name: 'Boots of Speed',
          cost: 500,
          stats: { moveSpeed: 1 },
          consumable: false,
        },
        blink_module: {
          id: 'blink_module',
          name: 'Blink Module',
          cost: 2150,
          stats: { attack: 10 },
          consumable: false,
          active: {
            id: 'blink_active',
            name: 'Blink',
            description: 'Teleport to adjacent zone',
            cooldownTicks: 12,
          },
        },
      }

      it('suggests only active items owned by player', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ items: ['boots_of_speed', 'blink_module', null, null, null, null] }),
          items: sampleItems,
        })
        // Use a partial that matches both items' shared substring
        const suggestions = autocomplete('use b', context)
        const texts = suggestions.map((s) => s.text)

        expect(texts).toContain('blink_module')
        expect(texts).not.toContain('boots_of_speed')
      })

      it('includes active ability description', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ items: ['blink_module', null, null, null, null, null] }),
          items: sampleItems,
        })
        const suggestions = autocomplete('use blink', context)
        const blink = suggestions.find((s) => s.text === 'blink_module')

        expect(blink).toBeDefined()
        expect(blink!.description).toContain('Teleport to adjacent zone')
      })

      it('returns empty when no items in context', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('use blink', context)

        expect(suggestions).toEqual([])
      })
    })

    describe('ward zone completion', () => {
      it('suggests adjacent zones for ward', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ zone: 'mid-t1-rad' }),
        })
        const suggestions = autocomplete('ward mid', context)

        const texts = suggestions.map((s) => s.text)
        // mid-t1-rad is adjacent to mid-t2-rad and mid-river
        expect(texts.some((t) => t.includes('mid'))).toBe(true)
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

// ── validateCommand Tests ─────────────────────────────────────────

describe('validateCommand', () => {
  it('rejects normal actions while dead', () => {
    const ctx = makeContext({ player: makePlayer({ alive: false }) })
    expect(validateCommand({ type: 'move', zone: 'mid-river' }, ctx)).toMatch(/dead/i)
    expect(validateCommand({ type: 'attack', target: { kind: 'self' } }, ctx)).toMatch(/dead/i)
  })

  describe('buyback', () => {
    it('allows buyback while dead with enough gold', () => {
      const ctx = makeContext({
        player: makePlayer({ alive: false, gold: 1000, buybackCost: 300 }),
      })
      expect(validateCommand({ type: 'buyback' }, ctx)).toBeNull()
    })

    it('rejects buyback while alive', () => {
      const ctx = makeContext({ player: makePlayer({ alive: true }) })
      expect(validateCommand({ type: 'buyback' }, ctx)).toMatch(/only available while dead/i)
    })

    it('rejects buyback with insufficient gold and shows shortfall', () => {
      const ctx = makeContext({
        player: makePlayer({ alive: false, gold: 100, buybackCost: 300 }),
      })
      const err = validateCommand({ type: 'buyback' }, ctx)
      expect(err).toMatch(/gold/i)
      expect(err).toContain('200')
    })

    it('rejects buyback on cooldown when tick is known', () => {
      const ctx = makeContext({
        player: makePlayer({ alive: false, gold: 9999, buybackCost: 300, buybackCooldown: 50 }),
        tick: 40,
      })
      const err = validateCommand({ type: 'buyback' }, ctx)
      expect(err).toMatch(/cooldown/i)
      expect(err).toContain('10')
    })

    it('allows buyback once the cooldown has expired', () => {
      const ctx = makeContext({
        player: makePlayer({ alive: false, gold: 9999, buybackCost: 300, buybackCooldown: 50 }),
        tick: 60,
      })
      expect(validateCommand({ type: 'buyback' }, ctx)).toBeNull()
    })

    it('falls back to the mirrored cost formula when buybackCost is unset', () => {
      // base 100 + level 3 * 25 + deaths 1 * 10 = 185
      const player = makePlayer({ alive: false, gold: 100, buybackCost: 0, level: 3, deaths: 1 })
      expect(buybackCostFor(player)).toBe(185)

      const err = validateCommand({ type: 'buyback' }, makeContext({ player }))
      expect(err).toContain('85')
    })
  })

  describe('surrender', () => {
    it('is exempt from the dead-player gate', () => {
      const ctx = makeContext({ player: makePlayer({ alive: false }), tick: 300 })
      expect(validateCommand({ type: 'surrender', vote: 'yes' }, ctx)).toBeNull()
    })

    it('rejects surrender before the minimum tick', () => {
      const ctx = makeContext({ tick: 100 })
      const err = validateCommand({ type: 'surrender', vote: 'yes' }, ctx)
      expect(err).toMatch(/too early/i)
      expect(err).toContain('225')
    })

    it('allows surrender after the minimum tick', () => {
      const ctx = makeContext({ tick: 225 })
      expect(validateCommand({ type: 'surrender', vote: 'yes' }, ctx)).toBeNull()
    })

    it('skips the timing check when tick is unknown', () => {
      expect(validateCommand({ type: 'surrender', vote: 'yes' }, makeContext())).toBeNull()
    })
  })

  describe('select_talent', () => {
    it('allows a reached, unchosen tier', () => {
      const ctx = makeContext({ player: makePlayer({ level: 10 }) })
      expect(validateCommand({ type: 'select_talent', tier: 10, talentId: 'x' }, ctx)).toBeNull()
    })

    it('rejects a tier above the current level', () => {
      const ctx = makeContext({ player: makePlayer({ level: 9 }) })
      const err = validateCommand({ type: 'select_talent', tier: 10, talentId: 'x' }, ctx)
      expect(err).toMatch(/reach level 10/i)
    })

    it('rejects a tier already chosen', () => {
      const ctx = makeContext({
        player: makePlayer({
          level: 16,
          talents: { tier10: 'echo_10_left', tier15: null, tier20: null, tier25: null },
        }),
      })
      const err = validateCommand({ type: 'select_talent', tier: 10, talentId: 'y' }, ctx)
      expect(err).toMatch(/already chose/i)
    })

    it('is exempt from the dead-player gate (can pick while dead)', () => {
      const ctx = makeContext({ player: makePlayer({ alive: false, level: 10 }) })
      expect(validateCommand({ type: 'select_talent', tier: 10, talentId: 'x' }, ctx)).toBeNull()
    })
  })

  it('passes a valid adjacent move', () => {
    // mid-t1-rad is adjacent to mid-river and mid-t2-rad
    expect(validateCommand({ type: 'move', zone: 'mid-river' }, makeContext())).toBeNull()
  })

  it('rejects a non-adjacent move and lists reachable zones', () => {
    const err = validateCommand({ type: 'move', zone: 'dire-fountain' }, makeContext())
    expect(err).toMatch(/one zone per tick/i)
    expect(err).toContain('mid-river')
  })

  it('rejects move while rooted', () => {
    const ctx = makeContext({
      player: makePlayer({
        buffs: [{ id: 'root', stacks: 1, ticksRemaining: 2, source: 'e1' }],
      }),
    })
    expect(validateCommand({ type: 'move', zone: 'mid-river' }, ctx)).toMatch(/rooted/)
  })

  it('rejects cast on cooldown with tick count', () => {
    const ctx = makeContext({
      player: makePlayer({ cooldowns: { q: 3, w: 0, e: 0, r: 0 } }),
    })
    const err = validateCommand({ type: 'cast', ability: 'q' }, ctx)
    expect(err).toMatch(/cooldown/)
    expect(err).toContain('3')
  })

  it('rejects cast without enough mana', () => {
    // echo r costs 150 mana
    const ctx = makeContext({ player: makePlayer({ mp: 100 }) })
    const err = validateCommand({ type: 'cast', ability: 'r' }, ctx)
    expect(err).toMatch(/mana/)
  })

  it('allows cast with enough mana and no cooldown', () => {
    const ctx = makeContext({ player: makePlayer({ mp: 280 }) })
    expect(validateCommand({ type: 'cast', ability: 'q' }, ctx)).toBeNull()
  })

  it('rejects cast while silenced', () => {
    const ctx = makeContext({
      player: makePlayer({
        buffs: [{ id: 'silence', stacks: 1, ticksRemaining: 1, source: 'e1' }],
      }),
    })
    expect(validateCommand({ type: 'cast', ability: 'q' }, ctx)).toMatch(/silenced/)
  })

  it('rejects buy outside a shop zone', () => {
    // mid-t1-rad has no shop
    const items: Record<string, ItemDef> = {
      boots: { id: 'boots', name: 'Boots', cost: 500, stats: {}, consumable: false },
    }
    const err = validateCommand({ type: 'buy', item: 'boots' }, makeContext({ items }))
    expect(err).toMatch(/shop/)
  })

  it('rejects buy without enough gold in a shop zone', () => {
    const items: Record<string, ItemDef> = {
      boots: { id: 'boots', name: 'Boots', cost: 500, stats: {}, consumable: false },
    }
    const ctx = makeContext({
      player: makePlayer({
        zone: 'radiant-fountain',
        gold: 100,
        items: [null, null, null, null, null, null],
      }),
      items,
    })
    const err = validateCommand({ type: 'buy', item: 'boots' }, ctx)
    expect(err).toMatch(/gold/)
    expect(err).toContain('400')
  })

  it('rejects duplicate unique item purchase', () => {
    const items: Record<string, ItemDef> = {
      boots: { id: 'boots', name: 'Boots', cost: 500, stats: {}, consumable: false },
    }
    const ctx = makeContext({
      player: makePlayer({ zone: 'radiant-fountain', gold: 9999 }),
      items,
    })
    expect(validateCommand({ type: 'buy', item: 'boots' }, ctx)).toMatch(/Already own/)
  })

  it('rejects buy with a full inventory', () => {
    const items: Record<string, ItemDef> = {
      sword: { id: 'sword', name: 'Sword', cost: 500, stats: {}, consumable: false },
    }
    const ctx = makeContext({
      player: makePlayer({
        zone: 'radiant-fountain',
        gold: 9999,
        items: ['a', 'b', 'c', 'd', 'e', 'f'],
      }),
      items,
    })
    expect(validateCommand({ type: 'buy', item: 'sword' }, ctx)).toMatch(/Inventory full/)
  })

  it('rejects attacking a hero that is not in your zone', () => {
    const ctx = makeContext({
      allPlayers: {
        p1: makePlayer(),
        e1: makePlayer({
          id: 'e1',
          name: 'Enemy',
          heroId: 'daemon',
          team: 'dire',
          zone: 'mid-river',
        }),
      },
    })
    expect(
      validateCommand({ type: 'attack', target: { kind: 'hero', name: 'daemon' } }, ctx),
    ).toMatch(/not in your zone/)
  })

  it('allows attacking a hero in your zone', () => {
    expect(
      validateCommand({ type: 'attack', target: { kind: 'hero', name: 'daemon' } }, makeContext()),
    ).toBeNull()
  })

  it('rejects ward placement in a non-adjacent zone', () => {
    expect(validateCommand({ type: 'ward', zone: 'dire-base' }, makeContext())).toMatch(/adjacent/)
  })

  it('rejects use of an item the player does not own', () => {
    const items: Record<string, ItemDef> = {
      tp: {
        id: 'tp',
        name: 'TP Scroll',
        cost: 80,
        stats: {},
        consumable: true,
        active: { id: 'tp-active', name: 'Teleport', description: 'Teleport', cooldownTicks: 10 },
      },
    }
    expect(validateCommand({ type: 'use', item: 'tp' }, makeContext({ items }))).toMatch(
      /not owned/i,
    )
  })
})

// ── pickAbilityTargetString ───────────────────────────────────────
describe('pickAbilityTargetString', () => {
  function makeAbility(
    targetType: string,
    effects: AbilityEffect[],
    overrides: Partial<AbilityDef> = {},
  ): AbilityDef {
    return {
      id: 'test-ability',
      name: 'Test Ability',
      description: '',
      manaCost: 50,
      cooldownTicks: 4,
      targetType: targetType as AbilityDef['targetType'],
      effects,
      ...overrides,
    }
  }

  const dmg: AbilityEffect[] = [{ type: 'damage', value: 100 }]
  const heal: AbilityEffect[] = [{ type: 'heal', value: 100 }]
  const buff: AbilityEffect[] = [{ type: 'buff', value: 0 }]

  it('returns no target for none/self abilities', () => {
    const caster = makePlayer()
    expect(pickAbilityTargetString(makeAbility('none', dmg), caster, { p1: caster })).toEqual({
      target: null,
    })
    expect(pickAbilityTargetString(makeAbility('self', heal), caster, { p1: caster })).toEqual({
      target: null,
    })
  })

  it('targets the lowest-HP enemy in zone for an offensive hero/unit ability', () => {
    const caster = makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' })
    const e1 = makePlayer({ id: 'e1', team: 'dire', zone: 'mid-river', hp: 400 })
    const e2 = makePlayer({ id: 'e2', team: 'dire', zone: 'mid-river', hp: 120 })
    const offZone = makePlayer({ id: 'e3', team: 'dire', zone: 'mid-t1-dire', hp: 10 })
    const all = { p1: caster, e1, e2, e3: offZone }
    expect(pickAbilityTargetString(makeAbility('hero', dmg), caster, all)).toEqual({
      target: 'hero:e2',
    })
    expect(pickAbilityTargetString(makeAbility('unit', dmg), caster, all)).toEqual({
      target: 'hero:e2',
    })
  })

  it('errors (no silent reject) when an offensive ability has no enemy in zone', () => {
    const caster = makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' })
    const result = pickAbilityTargetString(makeAbility('hero', dmg), caster, { p1: caster })
    expect(result).toHaveProperty('error')
  })

  it('targets the lowest-HP ally for a supportive hero ability', () => {
    const caster = makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river', hp: 500, maxHp: 500 })
    const a1 = makePlayer({ id: 'a1', team: 'radiant', zone: 'mid-river', hp: 100, maxHp: 500 })
    const all = { p1: caster, a1 }
    // Heal targetType 'hero' but supportive effects -> ally, not enemy
    expect(pickAbilityTargetString(makeAbility('hero', heal), caster, all)).toEqual({
      target: 'hero:a1',
    })
  })

  it('falls back to self for a heal/shield ally ability when alone', () => {
    const caster = makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' })
    expect(pickAbilityTargetString(makeAbility('ally', heal), caster, { p1: caster })).toEqual({
      target: 'hero:p1',
    })
  })

  it('errors for a pure-buff ally ability when no ally is present', () => {
    const caster = makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' })
    const result = pickAbilityTargetString(makeAbility('ally', buff), caster, { p1: caster })
    expect(result).toHaveProperty('error')
  })

  it('targets the current zone for an AoE zone ability', () => {
    const caster = makePlayer({ id: 'p1', team: 'radiant', zone: 'mid-river' })
    expect(pickAbilityTargetString(makeAbility('zone', dmg), caster, { p1: caster })).toEqual({
      target: 'zone:mid-river',
    })
  })
})
