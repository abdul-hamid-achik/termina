import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LearnPage from '../../../app/pages/learn.vue'
import { HEROES, HERO_IDS } from '../../../shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import {
  PASSIVE_GOLD_PER_TICK,
  ANCIENT_HP,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  RESPAWN_FREE_LEVELS,
  OBSERVER_WARD_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  KILL_BOUNTY_BASE,
  TOWER_HP_T1,
  TOWER_HP_T2,
  TOWER_HP_T3,
  TOWER_ATTACK,
} from '../../../shared/constants/balance'

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

  it('describes the Mainframe (Ancient) win condition, not the old all-towers one', () => {
    const text = mountLearn().text()
    expect(text).toContain('Mainframe')
    expect(text).toContain(`${ANCIENT_HP} HP`)
    expect(text).toContain('T3')
    expect(text).not.toContain('destroy the enemy base')
    expect(text).not.toContain('Destroy all 3 tower tiers in any lane to expose the enemy base')
  })

  it('does not claim a fictional ability-unlock schedule', () => {
    const text = mountLearn().text()
    expect(text).not.toContain('levels 1,3,5,7')
    expect(text).not.toContain('R (ultimate) at 6,12,18')
    expect(text).toContain('from level 1')
    expect(text).toContain('does not unlock abilities')
  })

  it('quotes live gold values from balance constants', () => {
    const text = mountLearn().text()
    expect(text).toContain(`${PASSIVE_GOLD_PER_TICK}g/tick`)
    expect(text).not.toContain('2g/tick')
    expect(text).toContain(`${CREEP_GOLD_MIN}-${CREEP_GOLD_MAX}g`)
    expect(text).toContain(`${KILL_BOUNTY_BASE}g base`)
  })

  it('states the real respawn formula (base + per-level after free levels)', () => {
    const text = mountLearn().text()
    expect(text).toContain(
      `${RESPAWN_BASE_TICKS} ticks + ${RESPAWN_PER_LEVEL_TICKS} per level after level ${RESPAWN_FREE_LEVELS}`,
    )
    // Old copy claimed "3 + (your level) ticks"
    expect(text).not.toContain('3 + (your level) ticks')
    // Level 1 = 3 ticks, level 10 = 12 ticks with current constants
    const lvl10 =
      RESPAWN_BASE_TICKS + RESPAWN_PER_LEVEL_TICKS * Math.max(0, 10 - RESPAWN_FREE_LEVELS)
    expect(text).toContain(`${lvl10} at level 10`)
  })

  it('documents the full live command verb set from useCommands', () => {
    const text = mountLearn().text()
    // Original 7
    for (const cmd of [
      'move <zone>',
      'attack [target]',
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
      'rune',
      'aegis',
      'glyph',
      'chat <team|all> <msg>',
      'ping <zone>',
      'buyback',
      'surrender confirm',
      'scan / status / map',
    ]) {
      expect(text).toContain(cmd)
    }
  })

  it('marks scan/status/map as not implemented rather than inventing behavior', () => {
    const text = mountLearn().text()
    expect(text).toContain('not implemented yet')
  })

  it('quotes live ward and tower numbers', () => {
    const text = mountLearn().text()
    expect(text).toContain(`(${ITEMS.observer_ward!.cost}g)`)
    expect(text).toContain(`${OBSERVER_WARD_DURATION_TICKS} ticks`)
    expect(text).toContain(`Max ${WARD_LIMIT_PER_TEAM} active per team`)
    expect(text).toContain(`T1 ${TOWER_HP_T1} HP, T2 ${TOWER_HP_T2} HP, T3 ${TOWER_HP_T3} HP`)
    expect(text).toContain(`hit for ${TOWER_ATTACK}`)
  })

  it('lists every hero name under its role, sourced from the hero registry', () => {
    const text = mountLearn().text()
    for (const hero of Object.values(HEROES)) {
      expect(text).toContain(hero.name)
    }
  })

  it('uses the real jungle zone naming (jungle-team-side)', () => {
    const text = mountLearn().text()
    expect(text).toContain('jungle-rad-top')
    expect(text).toContain('jungle-dire-bot')
    expect(text).not.toContain('rad-jungle-top')
  })

  it('does not claim Boots of Speed makes you move faster (move speed is 1 zone/tick)', () => {
    const text = mountLearn().text()
    expect(text).not.toContain('move faster')
    expect(text).not.toContain('Boots of Speed (+1 move speed)')
  })

  it('shows the corrected 5-tick fountain-to-mid-river example path', () => {
    const text = mountLearn().text()
    expect(text).toContain('move mid-river')
    expect(text).toContain('5 ticks (20 seconds)')
    expect(text).not.toContain('4 ticks to reach mid river')
  })

  it('teaches the team-relative base/fountain shortcuts', () => {
    const text = mountLearn().text()
    // The convenient alias must be discoverable — and framed as "your own side"
    // so a dire player knows `move base` won't send them to the enemy.
    expect(text).toContain('move base')
    expect(text).toContain('move fountain')
    expect(text.toLowerCase()).toContain('your side')
  })
})
