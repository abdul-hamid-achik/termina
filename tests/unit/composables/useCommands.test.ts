import { describe, it, expect } from 'vitest'
import { talentUnlockLevel } from '~~/shared/constants/talents'
import { HEROES } from '~~/shared/constants/heroes'
import {
  useCommands,
  validateCommand,
  buybackCostFor,
  pickAbilityTargetString,
  pickAttackTargetString,
  pickDenyTargetString,
  pickItemTargetString,
  formatStatusReadout,
  formatMapReadout,
  formatScanReadout,
  formatHelpReadout,
  type GameContext,
} from '~~/app/composables/useCommands'
import type { PlayerState, ZoneRuntimeState, WaveUnitState } from '~~/shared/types/game'
import type { ItemDef } from '~~/shared/types/items'
import type { AbilityDef, AbilityEffect } from '~~/shared/types/hero'
import { ZONE_IDS } from '~~/shared/constants/zones'
import { calculateBuybackCost } from '~~/server/game/engine/BuybackSystem'

/** The full game zone set, as the client actually receives it (state.zones). */
function allZones(): Record<string, ZoneRuntimeState> {
  const zones: Record<string, ZoneRuntimeState> = {}
  for (const id of ZONE_IDS) zones[id] = { id, wards: [], waves: [] }
  return zones
}

// ── Helpers ───────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-t1-chaff',
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
    iceDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

/**
 * A realistic slice of `state.waves` as the client receives it: server order,
 * mixed zones, mixed teams, and one corpse that has not been reaped yet.
 *
 * Zone-local indices for mid-t1-chaff are therefore 0=c0, 1=c1, 2=c2 (dead),
 * 3=c3, 4=c4 — deliberately offset from the global positions so anything that
 * numbers waves globally, or that renumbers after dropping the corpse, is
 * caught.
 */
function makeWaves(): WaveUnitState[] {
  return [
    { id: 'elsewhere', team: 'audit', zone: 'mid-river', hp: 400, maxHp: 400, type: 'line' },
    { id: 'c0', team: 'audit', zone: 'mid-t1-chaff', hp: 320, maxHp: 400, type: 'line' },
    { id: 'c1', team: 'chaff', zone: 'mid-t1-chaff', hp: 90, maxHp: 400, type: 'line' },
    { id: 'c2', team: 'audit', zone: 'mid-t1-chaff', hp: 0, maxHp: 250, type: 'sweep' },
    { id: 'c3', team: 'audit', zone: 'mid-t1-chaff', hp: 200, maxHp: 250, type: 'sweep' },
    { id: 'c4', team: 'chaff', zone: 'mid-t1-chaff', hp: 380, maxHp: 400, type: 'line' },
  ]
}

function makeContext(overrides: Partial<GameContext> = {}): GameContext {
  return {
    player: makePlayer(),
    // The client receives the full game zone set (state.zones), not just the
    // vision-visible ones — reflect that so move validation behaves realistically.
    visibleZones: allZones(),
    waves: makeWaves(),
    allPlayers: {
      p1: makePlayer(),
      e1: makePlayer({
        id: 'e1',
        name: 'Enemy',
        heroId: 'daemon',
        team: 'audit',
        zone: 'mid-t1-chaff',
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

      describe('team-relative base/fountain aliases', () => {
        it('resolves base/fountain to chaff zones by default (no team)', () => {
          const { parse } = useCommands()
          expect(parse('move base').command).toEqual({ type: 'move', zone: 'chaff-base' })
          expect(parse('move fountain').command).toEqual({
            type: 'move',
            zone: 'chaff-fountain',
          })
        })

        it('resolves base/fountain to the chaff player’s own side', () => {
          const { parse } = useCommands()
          expect(parse('move base', 'chaff').command).toEqual({
            type: 'move',
            zone: 'chaff-base',
          })
          expect(parse('move fountain', 'chaff').command).toEqual({
            type: 'move',
            zone: 'chaff-fountain',
          })
        })

        it('resolves base/fountain to the audit player’s own side (regression)', () => {
          // A audit player typing `move base` must NOT walk toward the enemy base.
          const { parse } = useCommands()
          expect(parse('move base', 'audit').command).toEqual({ type: 'move', zone: 'audit-base' })
          expect(parse('move fountain', 'audit').command).toEqual({
            type: 'move',
            zone: 'audit-fountain',
          })
        })

        it('applies team relativity to ward and ping too', () => {
          const { parse } = useCommands()
          expect(parse('ward base', 'audit').command).toEqual({ type: 'ward', zone: 'audit-base' })
          expect(parse('ping fountain', 'audit').command).toEqual({
            type: 'ping',
            zone: 'audit-fountain',
          })
        })

        it('leaves explicit zone ids and other aliases untouched regardless of team', () => {
          const { parse } = useCommands()
          expect(parse('move audit-base', 'chaff').command).toEqual({
            type: 'move',
            zone: 'audit-base',
          })
          expect(parse('move mid', 'audit').command).toEqual({ type: 'move', zone: 'mid-river' })
        })
      })

      describe('ambiguous zone words', () => {
        // REGRESSION: `cache` was aliased to mid-river — a zone with no cache in
        // it — so the command walked players straight past both cache spots.
        it('names both cache spots instead of resolving `move cache` to mid-river', () => {
          const { parse } = useCommands()
          const result = parse('move cache')

          expect(result.command).toBeNull()
          expect(result.error).toContain('cache-top')
          expect(result.error).toContain('cache-bot')
        })

        it('resolves the rt/rb shortcuts to the two cache spots', () => {
          const { parse } = useCommands()
          expect(parse('move rt').command).toEqual({ type: 'move', zone: 'cache-top' })
          expect(parse('move rb').command).toEqual({ type: 'move', zone: 'cache-bot' })
        })

        it('reports the ambiguity for ward and ping too', () => {
          const { parse } = useCommands()
          expect(parse('ward cache').error).toContain('ambiguous')
          expect(parse('ping cache').error).toContain('ambiguous')
        })

        it('summarises rather than listing when many zones match', () => {
          const { parse } = useCommands()
          const result = parse('move t')

          expect(result.command).toBeNull()
          expect(result.error).toContain('zones match')
        })
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

      it('parses attack wave target', () => {
        const { parse } = useCommands()
        const result = parse('attack wave:2')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'wave', index: 2 },
        })
      })

      it('parses attack ice target', () => {
        const { parse } = useCommands()
        const result = parse('attack ice:mid-t1-chaff')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'ice', zone: 'mid-t1-chaff' },
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

      // Tenant and the jungle camps are fully resolved server-side and farmed by
      // bots every match; without these two branches a human could not express
      // either intent at all.
      it('parses attack tenant (and the rosh shorthand)', () => {
        const { parse } = useCommands()

        expect(parse('attack tenant')).toEqual({
          command: { type: 'attack', target: { kind: 'tenant' } },
          error: null,
        })
        expect(parse('attack rosh')).toEqual({
          command: { type: 'attack', target: { kind: 'tenant' } },
          error: null,
        })
      })

      it('parses attack neutral:<index> as a global neutrals index', () => {
        const { parse } = useCommands()
        const result = parse('attack neutral:3')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'neutral', index: 3 },
        })
      })

      it('rejects a non-numeric neutral index', () => {
        const { parse } = useCommands()
        const result = parse('attack neutral:abc')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Invalid target')
      })

      it('advertises tenant and neutral in the usage and invalid-target hints', () => {
        const { parse } = useCommands()

        const usage = parse('attack').error!
        expect(usage).toContain('tenant')
        expect(usage).toContain('neutral:0')
        // There is no hero `axe` in this game — the old example was unusable.
        expect(usage).not.toContain('hero:axe')

        const invalid = parse('attack xyz_invalid').error!
        expect(invalid).toContain('tenant')
        expect(invalid).toContain('neutral:<index>')
      })
    })

    describe('burn command', () => {
      it('parses burn wave target', () => {
        const { parse } = useCommands()
        const result = parse('burn wave:3')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'burn',
          target: { kind: 'wave', index: 3 },
        })
      })

      it('rejects denying a non-wave target (only waves can be burned)', () => {
        const { parse } = useCommands()
        const result = parse('burn hero:daemon')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Can only burn allied waves')
      })

      it('returns usage error without a target', () => {
        const { parse } = useCommands()
        const result = parse('burn')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: burn')
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

    describe('help command', () => {
      it('parses help', () => {
        const { parse } = useCommands()
        const result = parse('help')
        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'help' })
      })

      it('parses the ? alias', () => {
        const { parse } = useCommands()
        const result = parse('?')
        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'help' })
      })

      it('an unknown command points the player at help', () => {
        const { parse } = useCommands()
        const result = parse('flibbertigibbet')
        expect(result.command).toBeNull()
        expect(result.error).toContain('help')
      })
    })

    describe('missing command (team callout advertised by help)', () => {
      it('parses missing <enemy>', () => {
        const { parse } = useCommands()
        const result = parse('missing axe')
        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'missing', enemyId: 'axe' })
      })

      it('accepts the ss / miss aliases', () => {
        const { parse } = useCommands()
        expect(parse('ss daemon').command).toEqual({ type: 'missing', enemyId: 'daemon' })
        expect(parse('miss daemon').command).toEqual({ type: 'missing', enemyId: 'daemon' })
      })

      it('errors with usage when no enemy is named', () => {
        const { parse } = useCommands()
        const result = parse('missing')
        expect(result.command).toBeNull()
        expect(result.error).toMatch(/usage/i)
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

    it('parses wave:index target', () => {
      const { parse } = useCommands()
      const result = parse('attack wave:0')

      expect(result.command).toEqual({
        type: 'attack',
        target: { kind: 'wave', index: 0 },
      })
    })

    it('parses ice:zone target', () => {
      const { parse } = useCommands()
      const result = parse('attack ice:top-t1-chaff')

      expect(result.command).toEqual({
        type: 'attack',
        target: { kind: 'ice', zone: 'top-t1-chaff' },
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

    it('rejects invalid wave index', () => {
      const { parse } = useCommands()
      const result = parse('attack wave:abc')

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

      it('suggests help (with a description) for "he"', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('he', makeContext())
        const help = suggestions.find((s) => s.text === 'help')
        expect(help).toBeDefined()
        expect(help!.description).toMatch(/command/i)
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

      it('describes the base alias team-relatively (matches what it resolves to)', () => {
        const { autocomplete } = useCommands()

        const chaff = autocomplete(
          'move base',
          makeContext({ player: makePlayer({ team: 'chaff' }) }),
        )
        expect(chaff.find((s) => s.text === 'base')?.description).toBe('→ Rookery Terminal')

        // A audit player's `base` suggestion must point at THEIR base, matching
        // how it resolves — not the enemy's.
        const audit = autocomplete(
          'move base',
          makeContext({ player: makePlayer({ team: 'audit' }) }),
        )
        expect(audit.find((s) => s.text === 'base')?.description).toBe('→ Landing Terminal')
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
            'mid-t1-chaff': { id: 'mid-t1-chaff', wards: [], waves: [] },
            'mid-river': { id: 'mid-river', wards: [], waves: [] },
          },
        })

        const suggestions = autocomplete('move mid', context)
        const texts = suggestions.map((s) => s.text)

        expect(texts).toContain('mid-t1-chaff')
        expect(texts).toContain('mid-river')
      })

      // REGRESSION: zone order put `mid-t3-chaff` first, so accepting the top
      // suggestion for `move mid` sent the player to their own tier-3 ice.
      it('ranks an exact alias above every prefix match', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('move mid', makeContext())

        expect(suggestions[0]?.text).toBe('mid')
        expect(suggestions[0]?.description).toContain('Coldstore Crossing')
        expect(suggestions.map((s) => s.text)).toContain('mid-t3-chaff')
      })

      it('does not rank an alias first when its zone is not on this map', () => {
        const { autocomplete } = useCommands()
        // A cut-down map (the one-lane tutorial shape): `top` resolves to
        // top-river, which does not exist here — the reachable zones win.
        const context = makeContext({
          visibleZones: {
            'top-t1-chaff': { id: 'top-t1-chaff', wards: [], waves: [] },
            'top-t2-chaff': { id: 'top-t2-chaff', wards: [], waves: [] },
          },
        })
        const suggestions = autocomplete('move top', context)

        expect(suggestions[0]?.text).not.toBe('top')
      })

      it('offers both cache spots and never mid-river for `move cache`', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('move cache', makeContext())

        expect(suggestions.map((s) => s.text)).toEqual(
          expect.arrayContaining(['cache-top', 'cache-bot']),
        )
        expect(
          suggestions.every((s) => !(s.description ?? '').includes('Coldstore Crossing')),
        ).toBe(true)
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

      // REGRESSION: these read ZoneRuntimeState.waves, a field the server
      // initialises to [] and never writes — the suggestion list had never once
      // been non-empty in a real game.
      it('suggests the ENEMY waves standing in your zone', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('attack wave', makeContext())

        // wave:1 is an ally — the server always refuses an attack on your own
        // wave (that is what `burn` is for), and an offered target that cannot
        // work costs the player their single action for the tick.
        const texts = suggestions.map((s) => s.text)
        expect(texts).toEqual(['wave:0', 'wave:3'])
      })

      it('numbers waves within the zone, not globally', () => {
        const { autocomplete } = useCommands()
        // `elsewhere` sits at global index 0 but in another zone; if it counted,
        // every suggestion here would be one too high and the attack would land
        // on the wrong wave.
        const suggestions = autocomplete('attack wave', makeContext())

        expect(suggestions[0]!.text).toBe('wave:0')
        expect(suggestions[0]!.description).toContain('320/400')
      })

      it('skips a dead-but-unreaped wave without renumbering the rest', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('attack wave', makeContext())

        const texts = suggestions.map((s) => s.text)
        expect(texts).not.toContain('wave:2') // c2 is the corpse
        expect(texts).toContain('wave:3') // c3 keeps its slot behind it
      })

      it('offers only enemies, and says so — a last-hit is not a burn', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('attack wave', makeContext())

        const byRef = new Map(suggestions.map((s) => [s.text, s.description]))
        expect(byRef.get('wave:0')).toContain('enemy')
        // The ally keeps its slot in the numbering but is never offered.
        expect(byRef.has('wave:1')).toBe(false)
      })

      it('offers no waves when the zone is empty', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({ player: makePlayer({ zone: 'top-t1-chaff' }) })
        const suggestions = autocomplete('attack wave', context)

        expect(suggestions).toEqual([])
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

      // The offered index must be the position in the whole neutrals array.
      // Re-indexing the in-zone survivors would send the attack at the camp
      // sitting at that position in some other jungle.
      it('suggests in-zone neutrals by their global index', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          neutrals: [
            {
              id: 'n0',
              zone: 'silt-audit-top',
              hp: 200,
              maxHp: 200,
              type: 'stub',
              alive: true,
            },
            {
              id: 'n1',
              zone: 'silt-audit-top',
              hp: 200,
              maxHp: 200,
              type: 'stub',
              alive: true,
            },
            { id: 'n2', zone: 'mid-t1-chaff', hp: 140, maxHp: 200, type: 'warden', alive: true },
            { id: 'n3', zone: 'mid-t1-chaff', hp: 0, maxHp: 200, type: 'warden', alive: false },
          ],
        })
        const suggestions = autocomplete('attack neutral', context)

        expect(suggestions.map((s) => s.text)).toEqual(['neutral:2'])
        expect(suggestions[0]!.description).toContain('warden')
      })

      it('suggests tenant only from inside the pit', () => {
        const { autocomplete } = useCommands()

        expect(autocomplete('attack ten', makeContext()).map((s) => s.text)).not.toContain('tenant')

        const inPit = makeContext({ player: makePlayer({ zone: 'hollow' }) })
        expect(autocomplete('attack ten', inPit).map((s) => s.text)).toContain('tenant')
      })
    })

    describe('target completion for burn', () => {
      it('offers only your own waves, at the index the server resolves', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('burn wave', makeContext())

        expect(suggestions.map((s) => s.text)).toEqual(['wave:1', 'wave:4'])
      })

      it('flags which allied wave is actually low enough to burn', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('burn wave', makeContext())

        const byRef = new Map(suggestions.map((s) => [s.text, s.description]))
        expect(byRef.get('wave:1')).toContain('denyable') // 90/400
        expect(byRef.get('wave:4')).not.toContain('denyable') // 380/400
      })

      it('agrees with the bare-burn auto-target', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggested = autocomplete('burn wave', context).map((s) => s.text)

        expect(suggested).toContain(
          (pickDenyTargetString(context.player!, context.waves!) as { target: string }).target,
        )
      })

      it('offers nothing when your waves are all dead', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          waves: makeWaves().map((c) => (c.team === 'chaff' ? { ...c, hp: 0 } : c)),
        })

        expect(autocomplete('burn wave', context)).toEqual([])
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
        trauma_patch: {
          id: 'trauma_patch',
          name: 'Trauma Patch',
          cost: 150,
          stats: {},
          consumable: true,
          maxStacks: 3,
          active: {
            id: 'trauma_patch_active',
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
        const suggestions = autocomplete('buy trauma', context)

        expect(suggestions.length).toBeGreaterThan(0)
        const salve = suggestions.find((s) => s.text === 'trauma_patch')
        expect(salve).toBeDefined()
        expect(salve!.description).toContain('150sc')
      })

      it('shows [affordable] when player has enough gold', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ gold: 300 }),
          items: sampleItems,
        })
        const suggestions = autocomplete('buy trauma', context)
        const salve = suggestions.find((s) => s.text === 'trauma_patch')

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
        expect(boots!.description).toContain('[need 400sc]')
      })

      it('returns empty when no items in context', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('buy trauma', context)

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
        trauma_patch: {
          id: 'trauma_patch',
          name: 'Trauma Patch',
          cost: 150,
          stats: {},
          consumable: true,
          maxStacks: 3,
          active: {
            id: 'trauma_patch_active',
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
            items: ['boots_of_speed', 'trauma_patch', null, null, null, null],
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
          player: makePlayer({ zone: 'mid-t1-chaff' }),
        })
        const suggestions = autocomplete('ward mid', context)

        const texts = suggestions.map((s) => s.text)
        // mid-t1-chaff is adjacent to mid-t2-chaff and mid-river
        expect(texts.some((t) => t.includes('mid'))).toBe(true)
      })

      it('ranks an exact alias first when it resolves to an adjacent zone', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({ player: makePlayer({ zone: 'mid-t1-chaff' }) })
        const suggestions = autocomplete('ward mid', context)

        expect(suggestions[0]?.text).toBe('mid')
        expect(suggestions[0]?.description).toContain('Coldstore Crossing')
      })

      it('omits an alias that resolves out of ward range', () => {
        const { autocomplete } = useCommands()
        // The fountain touches only the base — mid-river is not wardable here.
        const context = makeContext({ player: makePlayer({ zone: 'chaff-fountain' }) })
        const suggestions = autocomplete('ward mid', context)

        expect(suggestions.map((s) => s.text)).not.toContain('mid')
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

    it('the client fallback formula stays in parity with the server (no preview drift)', () => {
      // buybackCostFor mirrors the server's calculateBuybackCost; if either
      // formula drifts the preview would lie about the cost. Lock them together
      // across a range of levels/deaths (buybackCost unset ⇒ the fallback runs).
      for (const level of [1, 6, 12, 18, 25]) {
        for (const deaths of [0, 1, 5, 12]) {
          const player = makePlayer({ buybackCost: 0, level, deaths })
          expect(buybackCostFor(player)).toBe(calculateBuybackCost(player))
        }
      }
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

  describe('cast mana pre-flight', () => {
    // THE bug this pre-flight exists to prevent: the registry's flat manaCost is
    // the RANK-1 figure, while the engine charges the per-level cost (~2.2x by
    // late game). Validating against the flat number told the player a cast was
    // affordable and then the server refused it — burning their one action for
    // the tick and saying nothing useful.
    it('validates against the cost the engine will actually charge at this level', () => {
      const hero = Object.values(HEROES).find(
        (h) => (h.abilities.q.manaCostByLevel?.length ?? 0) > 1,
      )
      expect(hero, 'need a hero with a scaling Q to test against').toBeTruthy()
      const table = hero!.abilities.q.manaCostByLevel!
      const lateCost = table[table.length - 1]!
      const rank1 = table[0]!
      expect(lateCost).toBeGreaterThan(rank1)

      // Enough mana for the rank-1 cost, NOT for what a level-25 hero pays.
      const mp = Math.floor((rank1 + lateCost) / 2)
      const ctx = makeContext({
        player: makePlayer({ heroId: hero!.id, level: 25, mp }),
      })
      const err = validateCommand({ type: 'cast', ability: 'q' }, ctx)
      expect(err).toMatch(/not enough mana/i)
      expect(err).toContain(String(lateCost))
    })

    it('still allows a cast the player can genuinely afford', () => {
      const hero = Object.values(HEROES).find(
        (h) => (h.abilities.q.manaCostByLevel?.length ?? 0) > 1,
      )
      const table = hero!.abilities.q.manaCostByLevel!
      const ctx = makeContext({
        player: makePlayer({ heroId: hero!.id, level: 25, mp: table[table.length - 1]! + 10 }),
      })
      expect(validateCommand({ type: 'cast', ability: 'q' }, ctx)).toBeNull()
    })
  })

  describe('select_talent', () => {
    it('allows a reached, unchosen tier', () => {
      const ctx = makeContext({ player: makePlayer({ level: 10 }) })
      expect(validateCommand({ type: 'select_talent', tier: 10, talentId: 'x' }, ctx)).toBeNull()
    })

    it('rejects a tier above the current level', () => {
      // Derived from the shared schedule: the tier name is an identifier, not a
      // level. Hardcoding 10 here would refuse a command the server accepts.
      const required = talentUnlockLevel(10)
      const ctx = makeContext({ player: makePlayer({ level: required - 1 }) })
      const err = validateCommand({ type: 'select_talent', tier: 10, talentId: 'x' }, ctx)
      expect(err).toMatch(new RegExp(`reach level ${required}`, 'i'))
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
    // mid-t1-chaff is adjacent to mid-river and mid-t2-chaff
    expect(validateCommand({ type: 'move', zone: 'mid-river' }, makeContext())).toBeNull()
  })

  it('passes a distant move — auto-path walks it one zone per tick', () => {
    expect(validateCommand({ type: 'move', zone: 'audit-fountain' }, makeContext())).toBeNull()
  })

  it('rejects a globally-adjacent zone that is not on THIS map (subset/one-lane)', () => {
    // On the one-lane map chaff-base keeps only mid-t3-chaff + chaff-fountain;
    // the top/bot T3s are globally adjacent but don't exist this game.
    const oneLaneZones: Record<string, ZoneRuntimeState> = {}
    for (const id of [
      'chaff-fountain',
      'chaff-base',
      'mid-t3-chaff',
      'mid-t2-chaff',
      'mid-t1-chaff',
      'mid-river',
      'mid-t1-audit',
      'mid-t2-audit',
      'mid-t3-audit',
      'audit-base',
      'audit-fountain',
    ]) {
      oneLaneZones[id] = { id, wards: [], waves: [] }
    }
    const ctx = makeContext({
      player: makePlayer({ zone: 'chaff-base' }),
      visibleZones: oneLaneZones,
    })

    // Mirrors the server: off-map (but globally adjacent) is rejected...
    expect(validateCommand({ type: 'move', zone: 'top-t3-chaff' }, ctx)).toMatch(
      /isn.t on this map/i,
    )
    // ...while the on-map adjacent move is allowed.
    expect(validateCommand({ type: 'move', zone: 'mid-t3-chaff' }, ctx)).toBeNull()
  })

  it('rejects move while rooted', () => {
    const ctx = makeContext({
      player: makePlayer({
        buffs: [{ id: 'root', stacks: 1, ticksRemaining: 2, source: 'e1' }],
      }),
    })
    expect(validateCommand({ type: 'move', zone: 'mid-river' }, ctx)).toMatch(/rooted/)
  })

  // ── Control-gate parity with the server (ActionResolver.validateAction) ──
  const debuff = (id: string) => ({ id, stacks: 1, ticksRemaining: 2, source: 'e1' })

  it('rejects move while taunted', () => {
    const ctx = makeContext({ player: makePlayer({ buffs: [debuff('taunt')] }) })
    expect(validateCommand({ type: 'move', zone: 'mid-river' }, ctx)).toMatch(/taunted/)
  })

  it('rejects attack while feared', () => {
    const ctx = makeContext({ player: makePlayer({ buffs: [debuff('feared')] }) })
    expect(validateCommand({ type: 'attack', target: { kind: 'hero', name: 'x' } }, ctx)).toMatch(
      /feared/,
    )
  })

  it('rejects attack while in ghost form', () => {
    const ctx = makeContext({ player: makePlayer({ buffs: [debuff('ghost_form')] }) })
    expect(validateCommand({ type: 'attack', target: { kind: 'hero', name: 'x' } }, ctx)).toMatch(
      /ghost form/,
    )
  })

  it('rejects every action while hexed', () => {
    const ctx = makeContext({ player: makePlayer({ buffs: [debuff('hex')] }) })
    expect(validateCommand({ type: 'move', zone: 'mid-river' }, ctx)).toMatch(/hexed/)
    expect(validateCommand({ type: 'cast', ability: 'q' }, ctx)).toMatch(/hexed/)
  })

  it('lets a magic-immune (BKB) hero act through soft control debuffs', () => {
    const ctx = makeContext({
      player: makePlayer({
        mp: 280,
        buffs: [debuff('stun'), debuff('silence'), debuff('root'), debuff('magic_immune')],
      }),
    })
    expect(validateCommand({ type: 'move', zone: 'mid-river' }, ctx)).toBeNull()
    expect(validateCommand({ type: 'cast', ability: 'q' }, ctx)).toBeNull()
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
    // echo r costs 150 mana — level 6 so the ultimate is unlocked and the mana
    // check (not the level gate) is what rejects.
    const ctx = makeContext({ player: makePlayer({ mp: 100, level: 6 }) })
    const err = validateCommand({ type: 'cast', ability: 'r' }, ctx)
    expect(err).toMatch(/mana/)
  })

  it('rejects casting the ultimate before level 6', () => {
    const ctx = makeContext({ player: makePlayer({ mp: 280, level: 5 }) })
    expect(validateCommand({ type: 'cast', ability: 'r' }, ctx)).toMatch(/level 6/)
  })

  it('allows the ultimate at level 6 with mana', () => {
    const ctx = makeContext({ player: makePlayer({ mp: 280, level: 6 }) })
    expect(validateCommand({ type: 'cast', ability: 'r' }, ctx)).toBeNull()
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
    // mid-t1-chaff has no shop
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
        zone: 'chaff-fountain',
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
      player: makePlayer({ zone: 'chaff-fountain', gold: 9999 }),
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
        zone: 'chaff-fountain',
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
          team: 'audit',
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

  it('rejects attacking Tenant from outside the pit', () => {
    expect(validateCommand({ type: 'attack', target: { kind: 'tenant' } }, makeContext())).toMatch(
      /hollow/,
    )
  })

  it('allows attacking Tenant from inside the pit', () => {
    const ctx = makeContext({ player: makePlayer({ zone: 'hollow' }) })
    expect(validateCommand({ type: 'attack', target: { kind: 'tenant' } }, ctx)).toBeNull()
  })

  it('rejects a neutral index that names a camp in another zone', () => {
    const ctx = makeContext({
      neutrals: [
        { id: 'n0', zone: 'silt-audit-top', hp: 200, maxHp: 200, type: 'stub', alive: true },
        { id: 'n1', zone: 'mid-t1-chaff', hp: 150, maxHp: 200, type: 'stub', alive: true },
      ],
    })
    expect(validateCommand({ type: 'attack', target: { kind: 'neutral', index: 0 } }, ctx)).toMatch(
      /not in your zone/,
    )
    expect(
      validateCommand({ type: 'attack', target: { kind: 'neutral', index: 1 } }, ctx),
    ).toBeNull()
  })

  it('rejects a neutral index with no camp behind it', () => {
    const ctx = makeContext({
      neutrals: [{ id: 'n0', zone: 'mid-t1-chaff', hp: 0, maxHp: 200, type: 'stub', alive: false }],
    })
    expect(validateCommand({ type: 'attack', target: { kind: 'neutral', index: 0 } }, ctx)).toMatch(
      /No neutral wave at index 0/,
    )
    expect(validateCommand({ type: 'attack', target: { kind: 'neutral', index: 7 } }, ctx)).toMatch(
      /No neutral wave at index 7/,
    )
  })

  it('leaves neutral targeting to the server when no neutrals array is supplied', () => {
    expect(
      validateCommand({ type: 'attack', target: { kind: 'neutral', index: 4 } }, makeContext()),
    ).toBeNull()
  })

  it('rejects ward placement in a non-adjacent zone', () => {
    expect(validateCommand({ type: 'ward', zone: 'audit-base' }, makeContext())).toMatch(/adjacent/)
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
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const e1 = makePlayer({ id: 'e1', team: 'audit', zone: 'mid-river', hp: 400 })
    const e2 = makePlayer({ id: 'e2', team: 'audit', zone: 'mid-river', hp: 120 })
    const offZone = makePlayer({ id: 'e3', team: 'audit', zone: 'mid-t1-audit', hp: 10 })
    const all = { p1: caster, e1, e2, e3: offZone }
    expect(pickAbilityTargetString(makeAbility('hero', dmg), caster, all)).toEqual({
      target: 'hero:e2',
    })
    expect(pickAbilityTargetString(makeAbility('unit', dmg), caster, all)).toEqual({
      target: 'hero:e2',
    })
  })

  it('errors (no silent reject) when an offensive ability has no enemy in zone', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const result = pickAbilityTargetString(makeAbility('hero', dmg), caster, { p1: caster })
    expect(result).toHaveProperty('error')
  })

  it('targets the lowest-HP ally for a supportive hero ability', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river', hp: 500, maxHp: 500 })
    const a1 = makePlayer({ id: 'a1', team: 'chaff', zone: 'mid-river', hp: 100, maxHp: 500 })
    const all = { p1: caster, a1 }
    // Heal targetType 'hero' but supportive effects -> ally, not enemy
    expect(pickAbilityTargetString(makeAbility('hero', heal), caster, all)).toEqual({
      target: 'hero:a1',
    })
  })

  it('falls back to self for a heal/shield ally ability when alone', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    expect(pickAbilityTargetString(makeAbility('ally', heal), caster, { p1: caster })).toEqual({
      target: 'hero:p1',
    })
  })

  it('errors for a pure-buff ally ability when no ally is present', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const result = pickAbilityTargetString(makeAbility('ally', buff), caster, { p1: caster })
    expect(result).toHaveProperty('error')
  })

  it('targets the current zone for an AoE zone ability', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    expect(pickAbilityTargetString(makeAbility('zone', dmg), caster, { p1: caster })).toEqual({
      target: 'zone:mid-river',
    })
  })
})

// ── pickAttackTargetString (bare `attack` auto-target) ────────────
describe('pickAttackTargetString', () => {
  it('targets the lowest-HP alive enemy hero in the player’s zone', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const e1 = makePlayer({ id: 'e1', team: 'audit', zone: 'mid-river', hp: 400 })
    const e2 = makePlayer({ id: 'e2', team: 'audit', zone: 'mid-river', hp: 90 })
    expect(pickAttackTargetString(me, { p1: me, e1, e2 })).toEqual({ target: 'hero:e2' })
  })

  it('ignores allies, dead enemies, and enemies in other zones', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const ally = makePlayer({ id: 'a1', team: 'chaff', zone: 'mid-river', hp: 10 })
    const deadEnemy = makePlayer({
      id: 'e1',
      team: 'audit',
      zone: 'mid-river',
      hp: 1,
      alive: false,
    })
    const offZone = makePlayer({ id: 'e2', team: 'audit', zone: 'mid-t1-audit', hp: 5 })
    const liveEnemy = makePlayer({ id: 'e3', team: 'audit', zone: 'mid-river', hp: 300 })
    const result = pickAttackTargetString(me, {
      p1: me,
      a1: ally,
      e1: deadEnemy,
      e2: offZone,
      e3: liveEnemy,
    })
    expect(result).toEqual({ target: 'hero:e3' })
  })

  it('errors with a wave/ice hint when no enemy hero is in the zone', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const result = pickAttackTargetString(me, { p1: me })
    expect('error' in result && result.error).toMatch(/no enemy hero/i)
    expect('error' in result && result.error).toMatch(/wave/i)
  })
})

// ── Informational command readouts (status / map / scan) ──────────
describe('informational readouts', () => {
  it('formatStatusReadout summarises the hero in one line', () => {
    const me = makePlayer({
      heroId: 'echo',
      level: 7,
      hp: 612.7,
      maxHp: 900,
      mp: 240.2,
      maxMp: 400,
      gold: 1850,
      kills: 4,
      deaths: 1,
      assists: 6,
      zone: 'mid-river',
    })
    const out = formatStatusReadout(me)
    expect(out).toContain('Lv7')
    expect(out).toContain('HP 612/900') // floored, not rounded up
    expect(out).toContain('MP 240/400')
    expect(out).toContain('1850g')
    expect(out).toContain('KDA 4/1/6')
    expect(out).toContain('Coldstore Crossing')
  })

  it('formatMapReadout names your zone and reachable neighbours', () => {
    const me = makePlayer({ zone: 'chaff-base' })
    const out = formatMapReadout(me)
    expect(out).toContain('Rookery Terminal')
    expect(out).toMatch(/Reachable:/)
    expect(out).toContain('Rookery Anchor') // chaff-base is adjacent to its fountain
  })

  it('formatMapReadout lists only the neighbours this game map actually has', () => {
    // REGRESSION: read straight off the global 32-zone graph, so on the one-lane
    // tutorial map it named the top/bot T3 ice — zones the game does not
    // contain and `move` would reject.
    const me = makePlayer({ zone: 'chaff-base' })
    const out = formatMapReadout(me, 'one_lane')
    expect(out).toContain('Rookery Anchor')
    expect(out).toContain('Coldstore T3 (CHAFF)')
    expect(out).not.toContain('Top Lane T3')
    expect(out).not.toContain('Bot Lane T3')
  })

  it('formatMapReadout falls back cleanly for a zone off the resolved map', () => {
    const me = makePlayer({ zone: 'cache-top' })
    expect(formatMapReadout(me, 'one_lane')).toContain('Reachable: —')
  })

  it('formatScanReadout lists visible enemy heroes, ignoring allies/dead/fogged', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const ally = makePlayer({ id: 'a1', team: 'chaff', zone: 'mid-river' })
    const enemy = makePlayer({ id: 'e1', team: 'audit', heroId: 'daemon', zone: 'mid-t1-audit' })
    const dead = makePlayer({ id: 'e2', team: 'audit', zone: 'mid-river', alive: false })
    const fogged = { ...makePlayer({ id: 'e3', team: 'audit', zone: 'top-river' }), fogged: true }
    const out = formatScanReadout(me, { p1: me, a1: ally, e1: enemy, e2: dead, e3: fogged })
    expect(out).toContain('1 enemy hero visible')
    expect(out).toContain('Daemon')
    expect(out).not.toContain('a1')
  })

  it('formatScanReadout reports an empty vision cleanly', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    expect(formatScanReadout(me, { p1: me })).toMatch(/no enemy heroes/i)
  })

  it('formatHelpReadout lists the core verbs and the win condition', () => {
    const lines = formatHelpReadout()
    const all = lines.join('\n')
    for (const verb of ['move', 'attack', 'cast', 'buy', 'ward', 'status']) {
      expect(all, `help should mention "${verb}"`).toContain(verb)
    }
    // It explains the objective so a new player knows what to do after the verbs.
    expect(all.toLowerCase()).toMatch(/mainframe|destroy/)
    // The `ss` reflex shortcut for the missing callout is discoverable here.
    expect(all).toContain('ss = missing')
    // One log line per group, each non-empty.
    expect(lines.length).toBeGreaterThanOrEqual(6)
    for (const line of lines) expect(line.trim().length).toBeGreaterThan(0)
  })
})

// ── pickDenyTargetString (bare `burn` auto-target) ────────────────
describe('pickDenyTargetString', () => {
  // Line wave max HP is 400; the burn threshold is 50% (200).
  const allied = (overrides: Partial<WaveUnitState>): WaveUnitState => ({
    id: 'c',
    team: 'chaff' as const,
    zone: 'mid-river',
    hp: 100,
    type: 'line' as const,
    ...overrides,
  })

  it('targets the lowest-HP eligible allied wave, by zone index', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const waves = [
      allied({ id: 'c0', hp: 180 }), // index 0 — eligible (<=200)
      allied({ id: 'c1', hp: 120 }), // index 1 — eligible, lowest HP
      allied({ id: 'c2', hp: 350 }), // index 2 — too healthy to burn
    ]
    expect(pickDenyTargetString(me, waves)).toEqual({ target: 'wave:1' })
  })

  it('indexes within the player’s zone only (matches the server convention)', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const waves = [
      allied({ id: 'x', zone: 'top-river', hp: 50 }), // other zone — not counted
      allied({ id: 'c0', zone: 'mid-river', hp: 150 }), // zone index 0
    ]
    expect(pickDenyTargetString(me, waves)).toEqual({ target: 'wave:0' })
  })

  it('ignores enemy waves and healthy allied waves', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    const waves = [
      allied({ id: 'e', team: 'audit', hp: 10 }), // enemy — you burn your OWN
      allied({ id: 'healthy', hp: 399 }), // above 50% — not denyable
    ]
    expect('error' in pickDenyTargetString(me, waves)).toBe(true)
  })

  it('respects per-type max HP (sweep threshold is lower)', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river' })
    // Sweep max HP 250 → threshold 125. A sweep wave at 130 is NOT denyable,
    // but a line wave (max 400, threshold 200) at 130 IS.
    const waves = [
      allied({ id: 'sweep', type: 'sweep', hp: 130 }),
      allied({ id: 'line', type: 'line', hp: 130 }),
    ]
    expect(pickDenyTargetString(me, waves)).toEqual({ target: 'wave:1' })
  })
})

// ── pickItemTargetString (bare `use <item>` auto-target) ──────────
describe('pickItemTargetString', () => {
  const me = () => makePlayer({ id: 'p1', team: 'chaff', zone: 'mid-river', hp: 200 })

  it('enemy → lowest-HP enemy hero in the zone', () => {
    const e1 = makePlayer({ id: 'e1', team: 'audit', zone: 'mid-river', hp: 500 })
    const e2 = makePlayer({ id: 'e2', team: 'audit', zone: 'mid-river', hp: 120 })
    expect(pickItemTargetString('enemy', me(), { p1: me(), e1, e2 })).toEqual({ target: 'hero:e2' })
  })

  it('enemy → error (no silent reject) when no enemy is in the zone', () => {
    const result = pickItemTargetString('enemy', me(), { p1: me() })
    expect('error' in result && result.error).toMatch(/no enemy hero/i)
  })

  it('ally → lowest-HP ally, falling back to self', () => {
    const ally = makePlayer({ id: 'a1', team: 'chaff', zone: 'mid-river', hp: 60 })
    expect(pickItemTargetString('ally', me(), { p1: me(), a1: ally })).toEqual({
      target: 'hero:a1',
    })
    // No other ally in zone → the player themself is the target.
    expect(pickItemTargetString('ally', me(), { p1: me() })).toEqual({ target: 'hero:p1' })
  })

  it('self / zone resolve without needing other players', () => {
    expect(pickItemTargetString('self', me(), {})).toEqual({ target: 'self' })
    expect(pickItemTargetString('zone', me(), {})).toEqual({ target: 'zone:mid-river' })
  })
})

// ── item targetType data integrity ────────────────────────────────
describe('item active targetType annotations', () => {
  it('only the unambiguous enemy-target actives are annotated', async () => {
    const { ITEMS } = await import('../../../shared/constants/items')
    const enemyTargeted = Object.values(ITEMS)
      .filter((i) => i.active?.targetType === 'enemy')
      .map((i) => i.id)
      .sort()
    // dagon / scythe / hurricane are enemy-only on the server; dual-use items
    // (ethereal, eul's, force, lotus) are deliberately left unset.
    expect(enemyTargeted).toEqual(['dagon', 'hurricane_pike', 'scythe_of_vyse'])
  })

  it('wards are zone-targeted so a bare use places one in your current zone', async () => {
    const { ITEMS } = await import('../../../shared/constants/items')
    const zoneTargeted = Object.values(ITEMS)
      .filter((i) => i.active?.targetType === 'zone')
      .map((i) => i.id)
      .sort()
    expect(zoneTargeted).toEqual(['camtap', 'sniffer'])
  })
})
