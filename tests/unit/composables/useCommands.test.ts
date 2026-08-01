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
  formatContactsReadout,
  formatNetReadout,
  formatLookReadout,
  formatHelpReadout,
  type GameContext,
} from '~~/app/composables/useCommands'
import type { PlayerState, ZoneRuntimeState, WaveUnitState } from '~~/shared/types/game'
import type { ItemDef } from '~~/shared/types/items'
import type { AbilityDef, AbilityEffect } from '~~/shared/types/hero'
import { ZONE_IDS } from '~~/shared/constants/zones'
import { calculateBuybackCost } from '~~/server/game/engine/BuybackSystem'
import { ZONE_MAP } from '~~/shared/constants/zones'

/** The full game zone set, as the client actually receives it (state.zones). */
function allZones(): Record<string, ZoneRuntimeState> {
  const zones: Record<string, ZoneRuntimeState> = {}
  for (const id of ZONE_IDS) zones[id] = { id, wards: [] }
  return zones
}

// ── Helpers ───────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'TestPlayer',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-t1-chaff',
    integ: 500,
    maxInteg: 550,
    bw: 200,
    maxBw: 280,
    level: 3,
    xp: 150,
    scrip: 300,
    items: ['scrap_lot', null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 5,
    ice: 15,
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
 * Zone-local indices for coldstore-t1-chaff are therefore 0=c0, 1=c1, 2=c2 (dead),
 * 3=c3, 4=c4 — deliberately offset from the global positions so anything that
 * numbers waves globally, or that renumbers after dropping the corpse, is
 * caught.
 */
function makeWaves(): WaveUnitState[] {
  return [
    {
      id: 'elsewhere',
      team: 'audit',
      zone: 'coldstore-cross',
      integ: 400,
      maxInteg: 400,
      type: 'line',
    },
    {
      id: 'c0',
      team: 'audit',
      zone: 'coldstore-t1-chaff',
      integ: 320,
      maxInteg: 400,
      type: 'line',
    },
    { id: 'c1', team: 'chaff', zone: 'coldstore-t1-chaff', integ: 90, maxInteg: 400, type: 'line' },
    { id: 'c2', team: 'audit', zone: 'coldstore-t1-chaff', integ: 0, maxInteg: 250, type: 'sweep' },
    {
      id: 'c3',
      team: 'audit',
      zone: 'coldstore-t1-chaff',
      integ: 200,
      maxInteg: 250,
      type: 'sweep',
    },
    {
      id: 'c4',
      team: 'chaff',
      zone: 'coldstore-t1-chaff',
      integ: 380,
      maxInteg: 400,
      type: 'line',
    },
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
        zone: 'coldstore-t1-chaff',
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
        const result = parse('move coldstore-cross')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'move', zone: 'coldstore-cross' })
      })

      it('returns error without zone arg', () => {
        const { parse } = useCommands()
        const result = parse('move')

        expect(result.command).toBeNull()
        expect(result.error).toBe('Usage: move <zone>')
      })

      describe('team-relative terminal/anchor aliases', () => {
        it('resolves terminal/anchor to chaff zones by default (no team)', () => {
          const { parse } = useCommands()
          expect(parse('move terminal').command).toEqual({ type: 'move', zone: 'rookery-terminal' })
          expect(parse('move anchor').command).toEqual({
            type: 'move',
            zone: 'rookery-anchor',
          })
        })

        it('resolves terminal/anchor to the chaff player’s own side', () => {
          const { parse } = useCommands()
          expect(parse('move terminal', 'chaff').command).toEqual({
            type: 'move',
            zone: 'rookery-terminal',
          })
          expect(parse('move anchor', 'chaff').command).toEqual({
            type: 'move',
            zone: 'rookery-anchor',
          })
        })

        it('resolves terminal/anchor to the audit player’s own side (regression)', () => {
          // A audit player typing `move terminal` must NOT walk toward the enemy Terminal.
          const { parse } = useCommands()
          expect(parse('move terminal', 'audit').command).toEqual({
            type: 'move',
            zone: 'landing-terminal',
          })
          expect(parse('move anchor', 'audit').command).toEqual({
            type: 'move',
            zone: 'landing-anchor',
          })
        })

        it('applies team relativity to tap and ping too', () => {
          const { parse } = useCommands()
          expect(parse('tap terminal', 'audit').command).toEqual({
            type: 'tap',
            zone: 'landing-terminal',
          })
          expect(parse('ping anchor', 'audit').command).toEqual({
            type: 'ping',
            zone: 'landing-anchor',
          })
        })

        it('leaves explicit zone ids and other aliases untouched regardless of team', () => {
          const { parse } = useCommands()
          expect(parse('move landing-terminal', 'chaff').command).toEqual({
            type: 'move',
            zone: 'landing-terminal',
          })
          expect(parse('move coldstore', 'audit').command).toEqual({
            type: 'move',
            zone: 'coldstore-cross',
          })
        })
      })

      describe('ambiguous zone words', () => {
        // REGRESSION: `cache` was aliased to coldstore-cross — a zone with no cache in
        // it — so the command walked players straight past both cache spots.
        it('names both cache spots instead of resolving `move cache` to coldstore-cross', () => {
          const { parse } = useCommands()
          const result = parse('move cache')

          expect(result.command).toBeNull()
          expect(result.error).toContain('cache-seawall')
          expect(result.error).toContain('cache-shallows')
        })

        it('resolves both cache-drop ids', () => {
          const { parse } = useCommands()
          expect(parse('move cache-seawall').command).toEqual({
            type: 'move',
            zone: 'cache-seawall',
          })
          expect(parse('move cache-shallows').command).toEqual({
            type: 'move',
            zone: 'cache-shallows',
          })
        })

        it('reports the ambiguity for tap and ping too', () => {
          const { parse } = useCommands()
          expect(parse('tap cache').error).toContain('ambiguous')
          expect(parse('ping cache').error).toContain('ambiguous')
        })

        it('summarises rather than listing when many zones match', () => {
          const { parse } = useCommands()
          const result = parse('move s')

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
        const result = parse('attack ice:coldstore-t1-chaff')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({
          type: 'attack',
          target: { kind: 'ice', zone: 'coldstore-t1-chaff' },
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

      // Tenant and the silt camps are fully resolved server-side and farmed by
      // bots every match; without this branch a human could not express the
      // intent at all. The old `rosh` shorthand is gone (no legacy aliases).
      it('parses attack tenant', () => {
        const { parse } = useCommands()

        expect(parse('attack tenant')).toEqual({
          command: { type: 'attack', target: { kind: 'tenant' } },
          error: null,
        })
        expect(parse('attack rosh')).toEqual({
          command: null,
          error: expect.stringContaining('Invalid target'),
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
        const result = parse('use scrap_lot')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'use', item: 'scrap_lot', target: undefined })
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
        const result = parse('buy scrap_lot')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'buy', item: 'scrap_lot' })
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
        const result = parse('sell scrap_lot')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'sell', item: 'scrap_lot' })
      })

      it('returns error without item', () => {
        const { parse } = useCommands()
        const result = parse('sell')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: sell')
      })
    })

    describe('tap command', () => {
      it('parses tap zone', () => {
        const { parse } = useCommands()
        const result = parse('tap coldstore-cross')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'tap', zone: 'coldstore-cross' })
      })

      it('returns error without zone', () => {
        const { parse } = useCommands()
        const result = parse('tap')

        expect(result.command).toBeNull()
        expect(result.error).toContain('Usage: tap')
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
          message: 'Hello everyone',
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
        const result = parse('ping coldstore-cross')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'ping', zone: 'coldstore-cross' })
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
        const result = parse('  move   coldstore-cross  ')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'move', zone: 'coldstore-cross' })
      })

      it('normalizes input to lowercase', () => {
        const { parse } = useCommands()
        const result = parse('MOVE Coldstore-Cross')

        expect(result.error).toBeNull()
        expect(result.command).toEqual({ type: 'move', zone: 'coldstore-cross' })
      })
    })
  })

  describe('shortcuts', () => {
    it('expands mv → move', () => {
      const { parse } = useCommands()
      const result = parse('mv coldstore-cross')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({ type: 'move', zone: 'coldstore-cross' })
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
      const result = parse('b scrap_lot')

      expect(result.error).toBeNull()
      expect(result.command).toEqual({ type: 'buy', item: 'scrap_lot' })
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
      const result = parse('attack ice:seawall-t1-chaff')

      expect(result.command).toEqual({
        type: 'attack',
        target: { kind: 'ice', zone: 'seawall-t1-chaff' },
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

      it('describes the terminal alias team-relatively (matches what it resolves to)', () => {
        const { autocomplete } = useCommands()

        const chaff = autocomplete(
          'move terminal',
          makeContext({ player: makePlayer({ team: 'chaff' }) }),
        )
        expect(chaff.find((s) => s.text === 'terminal')?.description).toBe('→ Rookery Terminal')

        // An AUDIT player's `terminal` suggestion must point at THEIR Terminal, matching
        // how it resolves — not the enemy's.
        const audit = autocomplete(
          'move terminal',
          makeContext({ player: makePlayer({ team: 'audit' }) }),
        )
        expect(audit.find((s) => s.text === 'terminal')?.description).toBe('→ Landing Terminal')
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
        const suggestions = autocomplete('move coldstore', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts.some((t) => t.includes('coldstore'))).toBe(true)
      })

      it('suggests visible zones when available', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          visibleZones: {
            'coldstore-t1-chaff': { id: 'coldstore-t1-chaff', wards: [] },
            'coldstore-cross': { id: 'coldstore-cross', wards: [] },
          },
        })

        const suggestions = autocomplete('move coldstore', context)
        const texts = suggestions.map((s) => s.text)

        expect(texts).toContain('coldstore-t1-chaff')
        expect(texts).toContain('coldstore-cross')
      })

      // REGRESSION: zone order put `coldstore-t3-chaff` first, so accepting the top
      // suggestion for `move mid` sent the player to their own tier-3 ice.
      it('ranks an exact alias above every prefix match', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('move coldstore', makeContext())

        expect(suggestions[0]?.text).toBe('coldstore')
        expect(suggestions[0]?.description).toContain('Coldstore Crossing')
        expect(suggestions.map((s) => s.text)).toContain('coldstore-t3-chaff')
      })

      it('does not rank an alias first when its zone is not on this map', () => {
        const { autocomplete } = useCommands()
        // A cut-down map (the one-lane tutorial shape): `top` resolves to
        // seawall-cross, which does not exist here — the reachable zones win.
        const context = makeContext({
          visibleZones: {
            'seawall-t1-chaff': { id: 'seawall-t1-chaff', wards: [] },
            'seawall-t2-chaff': { id: 'seawall-t2-chaff', wards: [] },
          },
        })
        const suggestions = autocomplete('move seawall', context)

        expect(suggestions[0]?.text).not.toBe('seawall')
      })

      it('offers both cache spots and never coldstore-cross for `move cache`', () => {
        const { autocomplete } = useCommands()
        const suggestions = autocomplete('move cache', makeContext())

        expect(suggestions.map((s) => s.text)).toEqual(
          expect.arrayContaining(['cache-seawall', 'cache-shallows']),
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
        const context = makeContext({ player: makePlayer({ zone: 'seawall-t1-chaff' }) })
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
      // sitting at that position in some other silt.
      it('suggests in-zone neutrals by their global index', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          neutrals: [
            {
              id: 'n0',
              zone: 'silt-audit-upper',
              integ: 200,
              maxInteg: 200,
              type: 'stub',
              alive: true,
            },
            {
              id: 'n1',
              zone: 'silt-audit-upper',
              integ: 200,
              maxInteg: 200,
              type: 'stub',
              alive: true,
            },
            {
              id: 'n2',
              zone: 'coldstore-t1-chaff',
              integ: 140,
              maxInteg: 200,
              type: 'warden',
              alive: true,
            },
            {
              id: 'n3',
              zone: 'coldstore-t1-chaff',
              integ: 0,
              maxInteg: 200,
              type: 'warden',
              alive: false,
            },
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
          waves: makeWaves().map((c) => (c.team === 'chaff' ? { ...c, integ: 0 } : c)),
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
        const suggestions = autocomplete('ping cold', context)

        const texts = suggestions.map((s) => s.text)
        expect(texts.some((t) => t.includes('coldstore'))).toBe(true)
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
            description: 'Restore INTEG',
            cooldownCycles: 0,
          },
        },
        scrap_lot: {
          id: 'scrap_lot',
          name: 'Scrap Lot',
          cost: 100,
          stats: { integ: 30, bw: 30, attack: 3, plate: 3, ice: 3 },
          consumable: false,
        },
        jump_shunt: {
          id: 'jump_shunt',
          name: 'Jump Shunt',
          cost: 2150,
          stats: { attack: 10 },
          consumable: false,
          active: {
            id: 'blink_active',
            name: 'Blink',
            description: 'Teleport to adjacent zone',
            cooldownCycles: 12,
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
          player: makePlayer({ scrip: 300 }),
          items: sampleItems,
        })
        const suggestions = autocomplete('buy trauma', context)
        const salve = suggestions.find((s) => s.text === 'trauma_patch')

        expect(salve).toBeDefined()
        expect(salve!.description).toContain('[affordable]')
      })

      it('shows scrip needed when player cannot afford', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ scrip: 100 }),
          items: sampleItems,
        })
        const suggestions = autocomplete('buy jump', context)
        const jump = suggestions.find((s) => s.text === 'jump_shunt')

        expect(jump).toBeDefined()
        expect(jump!.description).toContain('[need 2050sc]')
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
        scrap_lot: {
          id: 'scrap_lot',
          name: 'Scrap Lot',
          cost: 100,
          stats: { integ: 30, bw: 30, attack: 3, plate: 3, ice: 3 },
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
            description: 'Restore INTEG',
            cooldownCycles: 0,
          },
        },
        jump_shunt: {
          id: 'jump_shunt',
          name: 'Jump Shunt',
          cost: 2150,
          stats: { attack: 10 },
          consumable: false,
          active: {
            id: 'blink_active',
            name: 'Blink',
            description: 'Teleport',
            cooldownCycles: 12,
          },
        },
      }

      it('suggests only owned items matching partial', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({
            items: ['scrap_lot', 'trauma_patch', null, null, null, null],
          }),
          items: sampleItems,
        })
        const suggestions = autocomplete('sell scrap', context)
        const texts = suggestions.map((s) => s.text)

        expect(texts).toContain('scrap_lot')
        expect(texts).not.toContain('jump_shunt')
      })

      it('includes sell price in description', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ items: ['scrap_lot', null, null, null, null, null] }),
          items: sampleItems,
        })
        const suggestions = autocomplete('sell scrap', context)
        const boots = suggestions.find((s) => s.text === 'scrap_lot')

        expect(boots).toBeDefined()
        expect(boots!.description).toContain('sell: 50sc')
      })

      it('returns empty when no items in context', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('sell scrap', context)

        expect(suggestions).toEqual([])
      })
    })

    describe('use item completion', () => {
      const sampleItems: Record<string, ItemDef> = {
        scrap_lot: {
          id: 'scrap_lot',
          name: 'Scrap Lot',
          cost: 100,
          stats: { integ: 30, bw: 30, attack: 3, plate: 3, ice: 3 },
          consumable: false,
        },
        jump_shunt: {
          id: 'jump_shunt',
          name: 'Jump Shunt',
          cost: 2150,
          stats: { attack: 10 },
          consumable: false,
          active: {
            id: 'blink_active',
            name: 'Blink',
            description: 'Teleport to adjacent zone',
            cooldownCycles: 12,
          },
        },
      }

      it('suggests only active items owned by player', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ items: ['scrap_lot', 'jump_shunt', null, null, null, null] }),
          items: sampleItems,
        })
        // Use a partial that matches both items' shared substring
        const suggestions = autocomplete('use j', context)
        const texts = suggestions.map((s) => s.text)

        expect(texts).toContain('jump_shunt')
        expect(texts).not.toContain('scrap_lot')
      })

      it('includes active ability description', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ items: ['jump_shunt', null, null, null, null, null] }),
          items: sampleItems,
        })
        const suggestions = autocomplete('use jump', context)
        const blink = suggestions.find((s) => s.text === 'jump_shunt')

        expect(blink).toBeDefined()
        expect(blink!.description).toContain('Teleport to adjacent zone')
      })

      it('returns empty when no items in context', () => {
        const { autocomplete } = useCommands()
        const context = makeContext()
        const suggestions = autocomplete('use jump', context)

        expect(suggestions).toEqual([])
      })
    })

    describe('tap zone completion', () => {
      it('suggests adjacent zones for tap', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({
          player: makePlayer({ zone: 'coldstore-t1-chaff' }),
        })
        const suggestions = autocomplete('tap cold', context)

        const texts = suggestions.map((s) => s.text)
        // coldstore-t1-chaff is adjacent to coldstore-t2-chaff and coldstore-cross
        expect(texts.some((t) => t.includes('coldstore'))).toBe(true)
      })

      it('ranks an exact alias first when it resolves to an adjacent zone', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({ player: makePlayer({ zone: 'coldstore-t1-chaff' }) })
        const suggestions = autocomplete('tap coldstore', context)

        expect(suggestions[0]?.text).toBe('coldstore')
        expect(suggestions[0]?.description).toContain('Coldstore Crossing')
      })

      it('omits an alias that resolves out of ward range', () => {
        const { autocomplete } = useCommands()
        // The fountain touches only the base — coldstore-cross is not wardable here.
        const context = makeContext({ player: makePlayer({ zone: 'rookery-anchor' }) })
        const suggestions = autocomplete('tap coldstore', context)

        expect(suggestions.map((s) => s.text)).not.toContain('coldstore')
      })

      it('falls back to all zones when no player', () => {
        const { autocomplete } = useCommands()
        const context = makeContext({ player: null })
        const suggestions = autocomplete('tap cold', context)

        expect(suggestions.length).toBeGreaterThan(0)
      })
    })
  })

  describe('command history', () => {
    it('tracks command history', () => {
      const { history, addToHistory } = useCommands()

      addToHistory('move coldstore-cross')
      addToHistory('attack hero:echo')

      expect(history.value).toEqual(['attack hero:echo', 'move coldstore-cross'])
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
      addToHistory('move seawall-cross')

      expect(historyIndex.value).toBe(-1)
    })
  })
})

// ── validateCommand Tests ─────────────────────────────────────────

describe('validateCommand', () => {
  it('rejects normal actions while dead', () => {
    const ctx = makeContext({ player: makePlayer({ alive: false }) })
    expect(validateCommand({ type: 'move', zone: 'coldstore-cross' }, ctx)).toMatch(/dead/i)
    expect(validateCommand({ type: 'attack', target: { kind: 'self' } }, ctx)).toMatch(/dead/i)
  })

  describe('buyback', () => {
    it('allows buyback while dead with enough gold', () => {
      const ctx = makeContext({
        player: makePlayer({ alive: false, scrip: 1000, buybackCost: 300 }),
      })
      expect(validateCommand({ type: 'buyback' }, ctx)).toBeNull()
    })

    it('rejects buyback while alive', () => {
      const ctx = makeContext({ player: makePlayer({ alive: true }) })
      expect(validateCommand({ type: 'buyback' }, ctx)).toMatch(/only available while dead/i)
    })

    it('rejects buyback with insufficient scrip and shows shortfall', () => {
      const ctx = makeContext({
        player: makePlayer({ alive: false, scrip: 100, buybackCost: 300 }),
      })
      const err = validateCommand({ type: 'buyback' }, ctx)
      expect(err).toMatch(/scrip/i)
      expect(err).toContain('200')
    })

    it('rejects buyback on cooldown when tick is known', () => {
      const ctx = makeContext({
        player: makePlayer({ alive: false, scrip: 9999, buybackCost: 300, buybackCooldown: 50 }),
        cycle: 40,
      })
      const err = validateCommand({ type: 'buyback' }, ctx)
      expect(err).toMatch(/cooldown/i)
      expect(err).toContain('10')
    })

    it('allows buyback once the cooldown has expired', () => {
      const ctx = makeContext({
        player: makePlayer({ alive: false, scrip: 9999, buybackCost: 300, buybackCooldown: 50 }),
        cycle: 60,
      })
      expect(validateCommand({ type: 'buyback' }, ctx)).toBeNull()
    })

    it('falls back to the mirrored cost formula when buybackCost is unset', () => {
      // base 100 + level 3 * 25 + deaths 1 * 10 = 185
      const player = makePlayer({ alive: false, scrip: 100, buybackCost: 0, level: 3, deaths: 1 })
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
      const ctx = makeContext({ player: makePlayer({ alive: false }), cycle: 300 })
      expect(validateCommand({ type: 'surrender', vote: 'yes' }, ctx)).toBeNull()
    })

    it('rejects surrender before the minimum tick', () => {
      const ctx = makeContext({ cycle: 100 })
      const err = validateCommand({ type: 'surrender', vote: 'yes' }, ctx)
      expect(err).toMatch(/too early/i)
      expect(err).toContain('225')
    })

    it('allows surrender after the minimum tick', () => {
      const ctx = makeContext({ cycle: 225 })
      expect(validateCommand({ type: 'surrender', vote: 'yes' }, ctx)).toBeNull()
    })

    it('skips the timing check when tick is unknown', () => {
      expect(validateCommand({ type: 'surrender', vote: 'yes' }, makeContext())).toBeNull()
    })
  })

  describe('cast mana pre-flight', () => {
    // THE bug this pre-flight exists to prevent: the registry's flat bwCost is
    // the RANK-1 figure, while the engine charges the per-level cost (~2.2x by
    // late game). Validating against the flat number told the player a cast was
    // affordable and then the server refused it — burning their one action for
    // the tick and saying nothing useful.
    it('validates against the cost the engine will actually charge at this level', () => {
      const hero = Object.values(HEROES).find((h) => (h.abilities.q.bwCostByLevel?.length ?? 0) > 1)
      expect(hero, 'need a hero with a scaling Q to test against').toBeTruthy()
      const table = hero!.abilities.q.bwCostByLevel!
      const lateCost = table[table.length - 1]!
      const rank1 = table[0]!
      expect(lateCost).toBeGreaterThan(rank1)

      // Enough mana for the rank-1 cost, NOT for what a level-25 hero pays.
      const bw = Math.floor((rank1 + lateCost) / 2)
      const ctx = makeContext({
        player: makePlayer({ heroId: hero!.id, level: 25, bw }),
      })
      const err = validateCommand({ type: 'cast', ability: 'q' }, ctx)
      expect(err).toMatch(/not enough BW/i)
      expect(err).toContain(String(lateCost))
    })

    it('still allows a cast the player can genuinely afford', () => {
      const hero = Object.values(HEROES).find((h) => (h.abilities.q.bwCostByLevel?.length ?? 0) > 1)
      const table = hero!.abilities.q.bwCostByLevel!
      const ctx = makeContext({
        player: makePlayer({ heroId: hero!.id, level: 25, bw: table[table.length - 1]! + 10 }),
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
    // coldstore-t1-chaff is adjacent to coldstore-cross and coldstore-t2-chaff
    expect(validateCommand({ type: 'move', zone: 'coldstore-cross' }, makeContext())).toBeNull()
  })

  it('passes a distant move — auto-path walks it one zone per cycle', () => {
    expect(validateCommand({ type: 'move', zone: 'landing-anchor' }, makeContext())).toBeNull()
  })

  it('rejects a globally-adjacent zone that is not on THIS map (subset/one-lane)', () => {
    // On the one-lane map rookery-terminal keeps only coldstore-t3-chaff + rookery-anchor;
    // the top/bot T3s are globally adjacent but don't exist this game.
    const oneLaneZones: Record<string, ZoneRuntimeState> = {}
    for (const id of [
      'rookery-anchor',
      'rookery-terminal',
      'coldstore-t3-chaff',
      'coldstore-t2-chaff',
      'coldstore-t1-chaff',
      'coldstore-cross',
      'coldstore-t1-audit',
      'coldstore-t2-audit',
      'coldstore-t3-audit',
      'landing-terminal',
      'landing-anchor',
    ]) {
      oneLaneZones[id] = { id, wards: [] }
    }
    const ctx = makeContext({
      player: makePlayer({ zone: 'rookery-terminal' }),
      visibleZones: oneLaneZones,
    })

    // Mirrors the server: off-map (but globally adjacent) is rejected...
    expect(validateCommand({ type: 'move', zone: 'seawall-t3-chaff' }, ctx)).toMatch(
      /isn.t on this map/i,
    )
    // ...while the on-map adjacent move is allowed.
    expect(validateCommand({ type: 'move', zone: 'coldstore-t3-chaff' }, ctx)).toBeNull()
  })

  it('rejects move while rooted', () => {
    const ctx = makeContext({
      player: makePlayer({
        buffs: [{ id: 'root', stacks: 1, cyclesRemaining: 2, source: 'e1' }],
      }),
    })
    expect(validateCommand({ type: 'move', zone: 'coldstore-cross' }, ctx)).toMatch(/rooted/)
  })

  // ── Control-gate parity with the server (ActionResolver.validateAction) ──
  const debuff = (id: string) => ({ id, stacks: 1, cyclesRemaining: 2, source: 'e1' })

  it('rejects move while taunted', () => {
    const ctx = makeContext({ player: makePlayer({ buffs: [debuff('taunt')] }) })
    expect(validateCommand({ type: 'move', zone: 'coldstore-cross' }, ctx)).toMatch(/taunted/)
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
    expect(validateCommand({ type: 'move', zone: 'coldstore-cross' }, ctx)).toMatch(/hexed/)
    expect(validateCommand({ type: 'cast', ability: 'q' }, ctx)).toMatch(/hexed/)
  })

  it('lets a magic-immune (Hardshell) hero act through soft control debuffs', () => {
    const ctx = makeContext({
      player: makePlayer({
        bw: 280,
        buffs: [debuff('stun'), debuff('silence'), debuff('root'), debuff('airgap')],
      }),
    })
    expect(validateCommand({ type: 'move', zone: 'coldstore-cross' }, ctx)).toBeNull()
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
    const ctx = makeContext({ player: makePlayer({ bw: 100, level: 6 }) })
    const err = validateCommand({ type: 'cast', ability: 'r' }, ctx)
    expect(err).toMatch(/BW/)
  })

  it('rejects casting the ultimate before level 6', () => {
    const ctx = makeContext({ player: makePlayer({ bw: 280, level: 5 }) })
    expect(validateCommand({ type: 'cast', ability: 'r' }, ctx)).toMatch(/level 6/)
  })

  it('allows the ultimate at level 6 with mana', () => {
    const ctx = makeContext({ player: makePlayer({ bw: 280, level: 6 }) })
    expect(validateCommand({ type: 'cast', ability: 'r' }, ctx)).toBeNull()
  })

  it('allows cast with enough mana and no cooldown', () => {
    const ctx = makeContext({ player: makePlayer({ bw: 280 }) })
    expect(validateCommand({ type: 'cast', ability: 'q' }, ctx)).toBeNull()
  })

  it('rejects cast while silenced', () => {
    const ctx = makeContext({
      player: makePlayer({
        buffs: [{ id: 'silence', stacks: 1, cyclesRemaining: 1, source: 'e1' }],
      }),
    })
    expect(validateCommand({ type: 'cast', ability: 'q' }, ctx)).toMatch(/silenced/)
  })

  it('rejects buy outside a shop zone', () => {
    // coldstore-t1-chaff has no shop
    const items: Record<string, ItemDef> = {
      scrap_lot: { id: 'scrap_lot', name: 'Scrap Lot', cost: 500, stats: {}, consumable: false },
    }
    const err = validateCommand({ type: 'buy', item: 'scrap_lot' }, makeContext({ items }))
    expect(err).toMatch(/shop/)
  })

  it('rejects buy without enough scrip in a shop zone', () => {
    const items: Record<string, ItemDef> = {
      scrap_lot: { id: 'scrap_lot', name: 'Scrap Lot', cost: 500, stats: {}, consumable: false },
    }
    const ctx = makeContext({
      player: makePlayer({
        zone: 'rookery-anchor',
        scrip: 100,
        items: [null, null, null, null, null, null],
      }),
      items,
    })
    const err = validateCommand({ type: 'buy', item: 'scrap_lot' }, ctx)
    expect(err).toMatch(/scrip/)
    expect(err).toContain('400')
  })

  it('rejects duplicate unique item purchase', () => {
    const items: Record<string, ItemDef> = {
      scrap_lot: { id: 'scrap_lot', name: 'Scrap Lot', cost: 500, stats: {}, consumable: false },
    }
    const ctx = makeContext({
      player: makePlayer({ zone: 'rookery-anchor', scrip: 9999 }),
      items,
    })
    expect(validateCommand({ type: 'buy', item: 'scrap_lot' }, ctx)).toMatch(/Already own/)
  })

  it('rejects buy with a full inventory', () => {
    const items: Record<string, ItemDef> = {
      sword: { id: 'sword', name: 'Sword', cost: 500, stats: {}, consumable: false },
    }
    const ctx = makeContext({
      player: makePlayer({
        zone: 'rookery-anchor',
        scrip: 9999,
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
          zone: 'coldstore-cross',
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
        {
          id: 'n0',
          zone: 'silt-audit-upper',
          integ: 200,
          maxInteg: 200,
          type: 'stub',
          alive: true,
        },
        {
          id: 'n1',
          zone: 'coldstore-t1-chaff',
          integ: 150,
          maxInteg: 200,
          type: 'stub',
          alive: true,
        },
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
      neutrals: [
        {
          id: 'n0',
          zone: 'coldstore-t1-chaff',
          integ: 0,
          maxInteg: 200,
          type: 'stub',
          alive: false,
        },
      ],
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
    expect(validateCommand({ type: 'tap', zone: 'landing-terminal' }, makeContext())).toMatch(
      /adjacent/,
    )
  })

  it('rejects use of an item the player does not own', () => {
    const items: Record<string, ItemDef> = {
      tp: {
        id: 'tp',
        name: 'TP Scroll',
        cost: 80,
        stats: {},
        consumable: true,
        active: { id: 'tp-active', name: 'Teleport', description: 'Teleport', cooldownCycles: 10 },
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
      bwCost: 50,
      cooldownCycles: 4,
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

  it('targets the lowest-INTEG enemy in zone for an offensive hero/unit ability', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    const e1 = makePlayer({ id: 'e1', team: 'audit', zone: 'coldstore-cross', integ: 400 })
    const e2 = makePlayer({ id: 'e2', team: 'audit', zone: 'coldstore-cross', integ: 120 })
    const offZone = makePlayer({ id: 'e3', team: 'audit', zone: 'coldstore-t1-audit', integ: 10 })
    const all = { p1: caster, e1, e2, e3: offZone }
    expect(pickAbilityTargetString(makeAbility('hero', dmg), caster, all)).toEqual({
      target: 'hero:e2',
    })
    expect(pickAbilityTargetString(makeAbility('unit', dmg), caster, all)).toEqual({
      target: 'hero:e2',
    })
  })

  it('errors (no silent reject) when an offensive ability has no enemy in zone', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    const result = pickAbilityTargetString(makeAbility('hero', dmg), caster, { p1: caster })
    expect(result).toHaveProperty('error')
  })

  it('targets the lowest-INTEG ally for a supportive hero ability', () => {
    const caster = makePlayer({
      id: 'p1',
      team: 'chaff',
      zone: 'coldstore-cross',
      integ: 500,
      maxInteg: 500,
    })
    const a1 = makePlayer({
      id: 'a1',
      team: 'chaff',
      zone: 'coldstore-cross',
      integ: 100,
      maxInteg: 500,
    })
    const all = { p1: caster, a1 }
    // Heal targetType 'hero' but supportive effects -> ally, not enemy
    expect(pickAbilityTargetString(makeAbility('hero', heal), caster, all)).toEqual({
      target: 'hero:a1',
    })
  })

  it('falls back to self for a heal/shield ally ability when alone', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    expect(pickAbilityTargetString(makeAbility('ally', heal), caster, { p1: caster })).toEqual({
      target: 'hero:p1',
    })
  })

  it('errors for a pure-buff ally ability when no ally is present', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    const result = pickAbilityTargetString(makeAbility('ally', buff), caster, { p1: caster })
    expect(result).toHaveProperty('error')
  })

  it('targets the current zone for an AoE zone ability', () => {
    const caster = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    expect(pickAbilityTargetString(makeAbility('zone', dmg), caster, { p1: caster })).toEqual({
      target: 'zone:coldstore-cross',
    })
  })
})

// ── pickAttackTargetString (bare `attack` auto-target) ────────────
describe('pickAttackTargetString', () => {
  it('targets the lowest-INTEG alive enemy hero in the player’s zone', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    const e1 = makePlayer({ id: 'e1', team: 'audit', zone: 'coldstore-cross', integ: 400 })
    const e2 = makePlayer({ id: 'e2', team: 'audit', zone: 'coldstore-cross', integ: 90 })
    expect(pickAttackTargetString(me, { p1: me, e1, e2 })).toEqual({ target: 'hero:e2' })
  })

  it('ignores allies, dead enemies, and enemies in other zones', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    const ally = makePlayer({ id: 'a1', team: 'chaff', zone: 'coldstore-cross', integ: 10 })
    const deadEnemy = makePlayer({
      id: 'e1',
      team: 'audit',
      zone: 'coldstore-cross',
      integ: 1,
      alive: false,
    })
    const offZone = makePlayer({ id: 'e2', team: 'audit', zone: 'coldstore-t1-audit', integ: 5 })
    const liveEnemy = makePlayer({ id: 'e3', team: 'audit', zone: 'coldstore-cross', integ: 300 })
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
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
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
      integ: 612.7,
      maxInteg: 900,
      bw: 240.2,
      maxBw: 400,
      scrip: 1850,
      kills: 4,
      deaths: 1,
      assists: 6,
      zone: 'coldstore-cross',
    })
    const out = formatStatusReadout(me)
    expect(out).toContain('Lv7')
    expect(out).toContain('INTEG 612/900') // floored, not rounded up
    expect(out).toContain('BW 240/400')
    expect(out).toContain('1850sc')
    expect(out).toContain('KDA 4/1/6')
    expect(out).toContain('Coldstore Crossing')
  })

  it('formatMapReadout names your zone and reachable neighbours', () => {
    const me = makePlayer({ zone: 'rookery-terminal' })
    const out = formatMapReadout(me)
    expect(out).toContain('Rookery Terminal')
    expect(out).toMatch(/Reachable:/)
    expect(out).toContain('Rookery Anchor') // rookery-terminal is adjacent to its fountain
  })

  it('formatMapReadout lists only the neighbours this game map actually has', () => {
    // REGRESSION: read straight off the global 32-zone graph, so on the one-lane
    // tutorial map it named the top/bot T3 ice — zones the game does not
    // contain and `move` would reject.
    const me = makePlayer({ zone: 'rookery-terminal' })
    const out = formatMapReadout(me, 'one_lane')
    expect(out).toContain('Rookery Anchor')
    expect(out).toContain('Coldstore T3 (CHAFF)')
    expect(out).not.toContain('Top Lane T3')
    expect(out).not.toContain('Bot Lane T3')
  })

  it('formatMapReadout falls back cleanly for a zone off the resolved map', () => {
    const me = makePlayer({ zone: 'cache-seawall' })
    expect(formatMapReadout(me, 'one_lane')).toContain('Reachable: —')
  })

  /**
   * `scan` is the "what can I do right now" readout: what is in your zone, the
   * commands that hit it, where one cycle can take you. It used to list visible
   * enemy heroes, which is a subset of `who` — so the question a player actually
   * asks on a four-second clock had no answer at all.
   */
  describe('formatScanReadout', () => {
    const me = () => makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-t1-chaff' })

    it('names the zone and reports an empty one honestly', () => {
      const out = formatScanReadout(me(), { p1: me() }).join('\n')
      expect(out).toContain('Coldstore T1')
      expect(out).toMatch(/nothing standing here/i)
    })

    it('lists an enemy in your zone WITH the command that attacks it', () => {
      const enemy = makePlayer({
        id: 'e1',
        team: 'audit',
        heroId: 'daemon',
        zone: 'coldstore-t1-chaff',
      })
      const out = formatScanReadout(me(), { p1: me(), e1: enemy }).join('\n')
      expect(out).toContain('Daemon')
      // The point of the readout: a command you can type back verbatim.
      expect(out).toContain('attack hero:daemon')
    })

    it('ignores allies, the dead, and the fogged', () => {
      const ally = makePlayer({ id: 'a1', team: 'chaff', zone: 'coldstore-t1-chaff' })
      const dead = makePlayer({
        id: 'e2',
        team: 'audit',
        zone: 'coldstore-t1-chaff',
        alive: false,
      })
      const fogged = {
        ...makePlayer({ id: 'e3', team: 'audit', zone: 'seawall-cross' }),
        fogged: true,
      }
      const out = formatScanReadout(me(), { p1: me(), a1: ally, e2: dead, e3: fogged }).join('\n')
      expect(out).not.toContain('a1')
      expect(out).not.toContain('e2')
      expect(out).not.toContain('e3')
    })

    it('offers every adjacent zone as a move', () => {
      const out = formatScanReadout(me(), { p1: me() }, { visibleZoneIds: [] }).join('\n')
      const zone = ZONE_MAP['coldstore-t1-chaff']!
      for (const adj of zone.adjacentTo) expect(out).toContain(adj)
    })

    // The same rule TRACE follows: absence of contacts is not safety.
    it('marks an unseen neighbour as blind, never as clear', () => {
      const out = formatScanReadout(me(), { p1: me() }, { visibleZoneIds: [] }).join('\n')
      expect(out).toContain('?')
      expect(out).toMatch(/no feed/i)
    })

    it('flags a neighbour where hostiles are actually visible', () => {
      const zone = ZONE_MAP['coldstore-t1-chaff']!
      const neighbour = zone.adjacentTo[0]!
      const enemy = makePlayer({ id: 'e1', team: 'audit', heroId: 'daemon', zone: neighbour })
      const out = formatScanReadout(
        me(),
        { p1: me(), e1: enemy },
        { visibleZoneIds: [neighbour] },
      ).join('\n')
      expect(out).toContain(`${neighbour} ⚠1`)
    })
  })

  it('formatHelpReadout lists the core verbs and the win condition', () => {
    const lines = formatHelpReadout()
    const all = lines.join('\n')
    for (const verb of [
      'move',
      'attack',
      'cast',
      'buy',
      'tap',
      'status',
      'who',
      'net',
      'look',
      'grab',
    ]) {
      expect(all, `help should mention "${verb}"`).toContain(verb)
    }
    // It explains the objective so a new player knows what to do after the verbs.
    expect(all.toLowerCase()).toMatch(/terminal|destroy/)
    // The `ss` reflex shortcut for the missing callout is discoverable here.
    expect(all).toContain('ss = missing')
    // One log line per group, each non-empty.
    expect(lines.length).toBeGreaterThanOrEqual(6)
    for (const line of lines) expect(line.trim().length).toBeGreaterThan(0)
  })
})

// ── pickDenyTargetString (bare `burn` auto-target) ────────────────
describe('pickDenyTargetString', () => {
  // Line wave max INTEG is 400; the burn threshold is 50% (200).
  const allied = (overrides: Partial<WaveUnitState>): WaveUnitState => ({
    id: 'c',
    team: 'chaff' as const,
    zone: 'coldstore-cross',
    integ: 100,
    type: 'line' as const,
    ...overrides,
  })

  it('targets the lowest-INTEG eligible allied wave, by zone index', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    const waves = [
      allied({ id: 'c0', integ: 180 }), // index 0 — eligible (<=200)
      allied({ id: 'c1', integ: 120 }), // index 1 — eligible, lowest HP
      allied({ id: 'c2', integ: 350 }), // index 2 — too healthy to burn
    ]
    expect(pickDenyTargetString(me, waves)).toEqual({ target: 'wave:1' })
  })

  it('indexes within the player’s zone only (matches the server convention)', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    const waves = [
      allied({ id: 'x', zone: 'seawall-cross', integ: 50 }), // other zone — not counted
      allied({ id: 'c0', zone: 'coldstore-cross', integ: 150 }), // zone index 0
    ]
    expect(pickDenyTargetString(me, waves)).toEqual({ target: 'wave:0' })
  })

  it('ignores enemy waves and healthy allied waves', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    const waves = [
      allied({ id: 'e', team: 'audit', integ: 10 }), // enemy — you burn your OWN
      allied({ id: 'healthy', integ: 399 }), // above 50% — not denyable
    ]
    expect('error' in pickDenyTargetString(me, waves)).toBe(true)
  })

  it('respects per-type max INTEG (sweep threshold is lower)', () => {
    const me = makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross' })
    // Sweep max INTEG 250 → threshold 125. A sweep wave at 130 is NOT denyable,
    // but a line wave (max 400, threshold 200) at 130 IS.
    const waves = [
      allied({ id: 'sweep', type: 'sweep', integ: 130 }),
      allied({ id: 'line', type: 'line', integ: 130 }),
    ]
    expect(pickDenyTargetString(me, waves)).toEqual({ target: 'wave:1' })
  })
})

// ── pickItemTargetString (bare `use <item>` auto-target) ──────────
describe('pickItemTargetString', () => {
  const me = () => makePlayer({ id: 'p1', team: 'chaff', zone: 'coldstore-cross', integ: 200 })

  it('enemy → lowest-INTEG enemy hero in the zone', () => {
    const e1 = makePlayer({ id: 'e1', team: 'audit', zone: 'coldstore-cross', integ: 500 })
    const e2 = makePlayer({ id: 'e2', team: 'audit', zone: 'coldstore-cross', integ: 120 })
    expect(pickItemTargetString('enemy', me(), { p1: me(), e1, e2 })).toEqual({ target: 'hero:e2' })
  })

  it('enemy → error (no silent reject) when no enemy is in the zone', () => {
    const result = pickItemTargetString('enemy', me(), { p1: me() })
    expect('error' in result && result.error).toMatch(/no enemy hero/i)
  })

  it('ally → lowest-INTEG ally, falling back to self', () => {
    const ally = makePlayer({ id: 'a1', team: 'chaff', zone: 'coldstore-cross', integ: 60 })
    expect(pickItemTargetString('ally', me(), { p1: me(), a1: ally })).toEqual({
      target: 'hero:a1',
    })
    // No other ally in zone → the player themself is the target.
    expect(pickItemTargetString('ally', me(), { p1: me() })).toEqual({ target: 'hero:p1' })
  })

  it('self / zone resolve without needing other players', () => {
    expect(pickItemTargetString('self', me(), {})).toEqual({ target: 'self' })
    expect(pickItemTargetString('zone', me(), {})).toEqual({ target: 'zone:coldstore-cross' })
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
    // burnout / scythe / hurricane are enemy-only on the server; dual-use items
    // (ethereal, eul's, force, lotus) are deliberately left unset.
    expect(enemyTargeted).toEqual(['burnout', 'kickback_splice', 'lockout_shunt'])
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

describe('the R3-08 readouts (who / net / look)', () => {
  function me(over: Partial<PlayerState> = {}): PlayerState {
    return makePlayer({ zone: 'coldstore-cross', ...over })
  }

  it('who lists visible heroes with side, integ and cooldowns, plus fogged last-seen', () => {
    const player = me()
    const all = {
      p1: player,
      e1: makePlayer({
        id: 'e1',
        name: 'Enemy1',
        team: 'audit',
        heroId: 'daemon',
        zone: 'coldstore-t1-audit',
        integ: 300,
        maxInteg: 500,
        cooldowns: { q: 2, w: 0, e: 0, r: 0 },
      }),
      a1: makePlayer({
        id: 'a1',
        name: 'Ally1',
        team: 'chaff',
        heroId: 'kernel',
        zone: 'coldstore-cross',
      }),
    }
    const lines = formatContactsReadout(
      player,
      all,
      { e2: { zone: 'seawall-cross', cycle: 100 } },
      140,
    )
    expect(
      lines.some(
        (l) => l.startsWith('WHO · ✕ Daemon') && l.includes('INTEG 300/500') && l.includes('Q·2c'),
      ),
    ).toBe(true)
    expect(lines.some((l) => l.startsWith('WHO · ○ Kernel'))).toBe(true)
    expect(lines.some((l) => l.includes('fogged @ Seawall Crossing · 40c ago'))).toBe(true)
  })

  it('who with empty vision prints the empty line', () => {
    const player = me()
    expect(formatContactsReadout(player, { p1: player }, {}, 10)).toEqual([
      'WHO · no contacts in your vision',
    ])
  })

  it('net carries lead, vision, day/night and objectives in one line', () => {
    const text = formatNetReadout({
      chaffNetWorth: 5000,
      auditNetWorth: 3800,
      netWorthHistory: { chaff: [4000, 4500, 5000], audit: [3800, 3800, 3800] },
      visionText: 'vision 6/32 · no wards',
      dayNight: 'DAY · full vision',
      objectives: 'TENANT up · CACHE next 20c · BACKUP —',
    })
    expect(text).toContain('CHF +1.2k')
    expect(text).toContain('vision 6/32')
    expect(text).toContain('DAY · full vision')
    expect(text).toContain('TENANT up')
  })

  it('net reads even when tied', () => {
    const text = formatNetReadout({
      chaffNetWorth: 1000,
      auditNetWorth: 1000,
      netWorthHistory: null,
      visionText: 'vision 4/32',
      dayNight: 'NIGHT · vision reduced',
      objectives: 'TENANT dead 40c · CACHE haste @ Seawall Cache Drop · BACKUP in pit',
    })
    expect(text).toContain('even')
    expect(text).toContain('NIGHT')
  })

  it('look lists hostile waves with their server index and camps', () => {
    const player = me({ zone: 'coldstore-cross' })
    const waves = [
      {
        id: 'w0',
        team: 'audit' as const,
        zone: 'coldstore-cross',
        integ: 120,
        maxInteg: 400,
        type: 'line' as const,
      },
      {
        id: 'w1',
        team: 'chaff' as const,
        zone: 'coldstore-cross',
        integ: 400,
        maxInteg: 400,
        type: 'line' as const,
      },
      {
        id: 'w2',
        team: 'audit' as const,
        zone: 'coldstore-cross',
        integ: 0,
        maxInteg: 400,
        type: 'line' as const,
      },
    ]
    const lines = formatLookReadout(player, waves, [
      { id: 'n0', zone: 'coldstore-cross', alive: true, type: 'stub' },
    ])
    expect(lines[0]).toContain('1 hostile wave')
    expect(lines[0]).toContain('wave:0 120hp')
    expect(lines.some((l) => l.includes('1 friendly wave'))).toBe(true)
    expect(lines.some((l) => l.includes('camp: stub'))).toBe(true)
  })

  it('look with nothing in zone prints the empty line', () => {
    expect(formatLookReadout(me({ zone: 'coldstore-cross' }), [], [])).toEqual([
      'LOOK · nothing standing in Coldstore Crossing',
    ])
  })

  it('tab-completion offers who/net/look', () => {
    const { autocomplete } = useCommands()
    const texts = autocomplete('w', makeContext()).map((s) => s.text)
    expect(texts).toContain('who')
    expect(autocomplete('ne', makeContext()).map((s) => s.text)).toContain('net')
    expect(autocomplete('loo', makeContext()).map((s) => s.text)).toContain('look')
  })
})
