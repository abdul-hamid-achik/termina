import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LearnPage from '~~/app/pages/learn.vue'
import { HEROES, HERO_IDS, isHeroId } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import {
  PASSIVE_SCRIP_PER_CYCLE,
  TERMINAL_HP,
  RESPAWN_BASE_CYCLES,
  RESPAWN_PER_LEVEL_CYCLES,
  RESPAWN_FREE_LEVELS,
  CAMTAP_DURATION_CYCLES,
  WARD_LIMIT_PER_TEAM,
  WAVE_SCRIP,
  KILL_BOUNTY_BASE,
  ICE_HP_T1,
  ICE_HP_T2,
  ICE_HP_T3,
  ICE_ATTACK,
  BASIC_ABILITY_RANKS,
  ULTIMATE_UNLOCK_LEVEL,
  FOUNTAIN_HEAL_PER_CYCLE_PERCENT,
  FOUNTAIN_BW_PER_CYCLE_PERCENT,
  CLOT_RING_REGEN_PERCENT,
  DRIP_MASK_REGEN_PERCENT,
  REGEN_CACHE_HEAL_PERCENT,
  BURN_HP_THRESHOLD,
  BURN_SCRIP_RATIO,
  BURN_XP_RATIO,
  WAVE_SCRIP_MIN,
  WAVE_SCRIP_MAX,
  WAVE_XP,
  WAVE_XP_SHARED,
  LINE_UNIT_HP,
} from '~~/shared/constants/balance'
import { talentUnlockLevel } from '~~/shared/constants/talents'
import { getAbilityLevel } from '~~/server/game/heroes/_base'
import { useCommands } from '~~/app/composables/useCommands'
import { routeGameKey } from '~~/app/utils/gameKeys'

// TerminalPanel renders its default slot; NuxtLink/AsciiButton are
// Nuxt auto-imports stubbed out for plain vitest mounting.
function mountLearn() {
  return mount(LearnPage, {
    global: {
      stubs: {
        TerminalPanel: { template: '<section><slot /></section>' },
        NuxtLink: { template: '<a><slot /></a>' },
        AsciiButton: true,
      },
    },
  })
}

describe('learn page', () => {
  it('teaches the live hero count, not a hardcoded one', () => {
    const text = mountLearn().text()
    expect(text).toContain(`Choose from ${HERO_IDS.length} heroes`)
    expect(text).not.toContain('Choose from 10 heroes')
  })

  it('describes the Terminal (win structure) win condition, not the old all-ice one', () => {
    const text = mountLearn().text()
    expect(text).toContain('Terminal')
    expect(text).toContain(`${TERMINAL_HP} INTEG`)
    expect(text).toContain('T3')
    expect(text).not.toContain('destroy the enemy base')
    expect(text).not.toContain('Destroy all 3 ice tiers in any lane to expose the enemy base')
  })

  it('states the real ability-unlock schedule the engine enforces', () => {
    // REGRESSION: this test used to REQUIRE the page to say "does not unlock
    // abilities" — i.e. it enforced a falsehood. getAbilityLevel() returns 0 for
    // R below level 6, and resolveAbility rejects rank 0 with "Ability not yet
    // learned". A player read /learn, picked a hero for its ultimate, pressed R
    // in a real match and was refused with no warning anywhere.
    const text = mountLearn().text()
    expect(text).not.toContain('does not unlock abilities')
    // Derived from the shared schedule, not typed here, so the page and the
    // engine rule move together.
    expect(text).toContain(`unlocks at level ${ULTIMATE_UNLOCK_LEVEL}`)
    expect(text).toContain(BASIC_ABILITY_RANKS.join(', '))
    // Sanity-check the constants really are what the engine does.
    expect(getAbilityLevel(ULTIMATE_UNLOCK_LEVEL - 1, 'r')).toBe(0)
    expect(getAbilityLevel(ULTIMATE_UNLOCK_LEVEL, 'r')).toBe(1)
    expect(getAbilityLevel(1, 'q')).toBe(1)
  })

  it('quotes live scrip values from balance constants', () => {
    const text = mountLearn().text()
    expect(text).toContain(`${PASSIVE_SCRIP_PER_CYCLE}sc/cycle`)
    expect(text).not.toContain('2sc/tick')
    expect(text).toContain(`${WAVE_SCRIP}sc`)
    expect(text).toContain(`${KILL_BOUNTY_BASE}sc base`)
  })

  it('states the real respawn formula (base + per-level after free levels)', () => {
    const text = mountLearn().text()
    expect(text).toContain(
      `${RESPAWN_BASE_CYCLES} cycles + ${RESPAWN_PER_LEVEL_CYCLES} per level after level ${RESPAWN_FREE_LEVELS}`,
    )
    // Old copy claimed "3 + (your level) ticks"
    expect(text).not.toContain('3 + (your level) ticks')
    // Level 1 = 3 ticks, level 10 = 12 ticks with current constants
    const lvl10 =
      RESPAWN_BASE_CYCLES + RESPAWN_PER_LEVEL_CYCLES * Math.max(0, 10 - RESPAWN_FREE_LEVELS)
    expect(text).toContain(`${lvl10} at level 10`)
  })

  it('documents the full live command verb set from useCommands', () => {
    const text = mountLearn().text()
    // Original 7 + burn
    for (const cmd of [
      'move <zone>',
      'attack [target]',
      'burn [wave:N]',
      'cast <q|w|e|r> [target]',
      'use <item>',
      'buy <item>',
      'sell <item>',
      'ward <zone>',
    ]) {
      expect(text).toContain(cmd)
    }
    // Newly documented verbs
    for (const cmd of [
      'grab',
      'backup',
      'harden',
      'chat <team|all> <msg>',
      'ping <zone>',
      'buyback',
      'surrender confirm',
      'status / map / scan',
      'who / net / look',
    ]) {
      expect(text).toContain(cmd)
    }
  })

  it('documents status/map/scan as free informational readouts (no wasted cycle)', () => {
    const text = mountLearn().text()
    expect(text).toContain('status / map / scan')
    expect(text).toMatch(/costs no cycle/i)
    expect(text).not.toContain('not implemented yet')
  })

  it('quotes live ward and ice numbers', () => {
    const text = mountLearn().text()
    expect(text).toContain(`(${ITEMS.camtap!.cost}sc)`)
    expect(text).toContain(`${CAMTAP_DURATION_CYCLES} cycles`)
    expect(text).toContain(`Max ${WARD_LIMIT_PER_TEAM} active per team`)
    expect(text).toContain(`T1 ${ICE_HP_T1} INTEG, T2 ${ICE_HP_T2} INTEG, T3 ${ICE_HP_T3} INTEG`)
    expect(text).toContain(`hit for ${ICE_ATTACK}`)
  })

  it('lists every hero name under its role, sourced from the hero registry', () => {
    const text = mountLearn().text()
    for (const hero of Object.values(HEROES)) {
      expect(text).toContain(hero.name)
    }
  })

  it('uses the real silt zone naming (silt-team-side)', () => {
    const text = mountLearn().text()
    expect(text).toContain('silt-chaff-top')
    expect(text).toContain('silt-audit-bot')
    expect(text).not.toContain('rad-jungle-top')
  })

  it('does not claim Boots of Speed makes you move faster (move speed is 1 zone/tick)', () => {
    const text = mountLearn().text()
    expect(text).not.toContain('move faster')
    expect(text).not.toContain('Boots of Speed (+1 move speed)')
  })

  it('shows the corrected 5-cycle fountain-to-mid-river example path', () => {
    const text = mountLearn().text()
    expect(text).toContain('move mid-river')
    expect(text).toContain('5 cycles (20 seconds)')
    expect(text).not.toContain('4 ticks to reach mid river')
  })

  it('documents the silt and Tenant target forms the parser accepts', () => {
    const text = mountLearn().text()
    expect(text).toContain('neutral:<index>')
    expect(text).toContain('attack neutral:0')
    expect(text).toContain('attack tenant')
    expect(text).toContain('Backup')
  })

  // Divergence guard: the targeting table is the page a new player copies from,
  // so every example it prints has to survive the real parser. `attack hero:axe`
  // sat here for months naming a hero that does not exist.
  it('only prints targeting examples that actually parse', () => {
    const wrapper = mountLearn()
    const table = wrapper
      .findAll('table')
      .find((t) => t.find('caption').text().includes('Targeting format reference'))
    expect(table).toBeDefined()

    const examples = table!.findAll('tbody tr').map((row) => row.findAll('td').at(-1)!.text())
    expect(examples.length).toBeGreaterThanOrEqual(6)

    const { parse } = useCommands()
    for (const example of examples) {
      const result = parse(example)
      expect({ example, error: result.error }).toEqual({ example, error: null })
      const target = result.command && 'target' in result.command ? result.command.target : null
      if (target && typeof target === 'object' && target.kind === 'hero') {
        expect({ example, real: isHeroId(target.name) }).toEqual({ example, real: true })
      }
    }
  })

  /**
   * REGRESSION: the panel documented eight keys that do nothing in the state a
   * player is in when they arrive — the command prompt auto-focuses and eats
   * every keystroke. The copy now states the condition once, at panel level.
   */
  describe('keyboard shortcuts panel', () => {
    it('states the unfocused-prompt condition and how to get there', () => {
      const text = mountLearn().text()
      expect(text).toContain('Esc')
      expect(text).toContain('[KEYS]')
      expect(text).toContain('empty prompt')
      // The condition belongs to the whole panel, not to one row.
      expect(text).not.toContain('Quick-cast ability (input unfocused)')
    })

    it('documents only keys the game screen actually routes', () => {
      const wrapper = mountLearn()
      const keybinds = wrapper.vm.keybinds as Array<{
        key: string
        probe: string | null
        action: string
      }>
      const probed = keybinds.filter((k) => k.probe)
      expect(probed.length).toBeGreaterThanOrEqual(5)

      for (const k of probed) {
        // Live: the documented key does something in the world.
        const live = routeGameKey(k.probe!, {
          isInputFocused: false,
          overlayOpen: false,
          inCmdInput: false,
        }).type
        expect({ key: k.key, live }).not.toEqual({ key: k.key, live: 'none' })

        // Typing: it does not — which is exactly what the panel caveat claims.
        const typing = routeGameKey(k.probe!, {
          isInputFocused: true,
          overlayOpen: false,
          inCmdInput: false,
        }).type
        // Tab is the one that stays useful while typing — it autocompletes.
        expect({ key: k.key, typing }).toEqual({
          key: k.key,
          typing: k.probe === 'Tab' ? 'autocomplete' : 'none',
        })
      }
    })

    it('renders every documented binding', () => {
      const wrapper = mountLearn()
      const keybinds = wrapper.vm.keybinds as Array<{ key: string; action: string }>
      const text = wrapper.text()
      for (const k of keybinds) {
        expect(text).toContain(k.key)
        expect(text).toContain(k.action)
      }
    })
  })

  /**
   * Two rules the page stated a number for without ever stating what it means:
   * a fountain heal rate with no "and nothing else regenerates", and one
   * sentence about last-hitting for the mechanic the whole economy sits on.
   */
  describe('sustain and last-hitting concept cards', () => {
    it('states the no-innate-regen corollary, not just the fountain rate', () => {
      const text = mountLearn().text()
      expect(text).toContain('Sustain')
      expect(text).toContain('NO innate regeneration')
      // The rate is already on the page; the card names every actual source.
      expect(text).toContain(
        `${FOUNTAIN_HEAL_PER_CYCLE_PERCENT}% INTEG / ${FOUNTAIN_BW_PER_CYCLE_PERCENT}% BW per cycle`,
      )
      expect(text).toContain('out of combat')
      for (const source of [
        'Trauma Patch',
        'Charge Tab',
        'Clot Ring',
        'Drip Mask',
        'regeneration cache',
      ]) {
        expect(text).toContain(source)
      }
    })

    it('quotes live regen percentages rather than prose', () => {
      const text = mountLearn().text()
      expect(text).toContain(`${Math.round(CLOT_RING_REGEN_PERCENT * 100)}% max INTEG per cycle`)
      expect(text).toContain(`${Math.round(DRIP_MASK_REGEN_PERCENT * 100)}% max BW per cycle`)
      expect(text).toContain(`${Math.round(REGEN_CACHE_HEAL_PERCENT * 100)}% of both per cycle`)
    })

    it('teaches last-hitting as its own concept, with the burn mirror', () => {
      const text = mountLearn().text()
      expect(text).toContain('Last-Hitting & Burning')
      expect(text).toContain('Only the killing blow pays scrip')
      expect(text).toContain(`${LINE_UNIT_HP} INTEG`)
      expect(text).toContain(`${Math.round(BURN_HP_THRESHOLD * 100)}% INTEG`)
      // Burn reward is derived, not asserted as prose.
      const burnGold = Math.floor(((WAVE_SCRIP_MIN + WAVE_SCRIP_MAX) / 2) * BURN_SCRIP_RATIO)
      expect(text).toContain(`${burnGold}sc and ${Math.floor(WAVE_XP * BURN_XP_RATIO)} XP`)
    })

    it('warns that wave indices are positional and shift each cycle', () => {
      const text = mountLearn().text()
      expect(text).toContain('wave:N counts the living waves in your zone')
      expect(text).toMatch(/shifts every cycle/)
      expect(text).toContain('ActionRow')
    })

    it('states lane presence still pays XP, so the advice is not "never miss"', () => {
      const text = mountLearn().text()
      expect(text).toContain(`share ${WAVE_XP_SHARED} XP`)
    })
  })

  /**
   * REGRESSION: the talent copy printed the TIER ids (10/15/20/25) as if they
   * were the levels the tiers unlock at. They stopped being the same number
   * when the tiers were pulled forward to match real match length.
   */
  it('states the levels talents unlock at, not the tier ids', () => {
    const text = mountLearn().text()
    const levels = ([10, 15, 20, 25] as const).map(talentUnlockLevel)
    expect(text).toContain(`Reaching levels ${levels.slice(0, 3).join(', ')} and ${levels[3]}`)
    expect(text).not.toContain('Reaching levels 10, 15, 20 and 25')
  })

  it('teaches the team-relative base/fountain shortcuts', () => {
    const text = mountLearn().text()
    // The convenient alias must be discoverable — and framed as "your own side"
    // so a audit player knows `move base` won't send them to the enemy.
    expect(text).toContain('move base')
    expect(text).toContain('move fountain')
    expect(text.toLowerCase()).toContain('your side')
  })
})
