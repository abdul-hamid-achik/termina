import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ITEMS } from '~~/shared/constants/items'
import { HERO_IDS } from '~~/shared/constants/heroes'
import { TALENT_UNLOCK_LEVEL } from '~~/shared/constants/talents'
import {
  SURRENDER_MIN_CYCLE,
  SURRENDER_VOTE_THRESHOLD,
  STRIP_HP_THRESHOLD,
  BURN_HP_THRESHOLD,
  BURN_SCRIP_RATIO,
  BUYBACK_BASE_COST,
  BUYBACK_COST_PER_LEVEL,
  CYCLE_DURATION_MS,
} from '~~/shared/constants/balance'

/**
 * README is the public front page. These pin its rule claims to the engine
 * constants so it cannot drift back to "40+ items", a snake draft, or talents
 * at levels 10/15/20/25.
 */
const readme = readFileSync(resolve(__dirname, '../../../README.md'), 'utf8')
const pct = (n: number) => `${Math.round(n * 100)}%`

describe('README rule claims', () => {
  it('states the real item and hero counts', () => {
    expect(readme).toContain(`${Object.keys(ITEMS).length} Items`)
    expect(readme).not.toContain('40+ Items')
    expect(readme).toContain(`${HERO_IDS.length} Unique Heroes`)
  })

  it('states talent unlock LEVELS from TALENT_UNLOCK_LEVEL, not the tier names', () => {
    const levels = Object.values(TALENT_UNLOCK_LEVEL).join('/')
    expect(readme).toContain(`unlocking at hero levels ${levels}`)
    const lv = Object.values(TALENT_UNLOCK_LEVEL)
    expect(readme).toContain(`hero levels **${lv.slice(0, -1).join(', ')} and ${lv.at(-1)}**`)
    expect(readme).not.toMatch(/Level (10|15|20|25)\b/)
    expect(readme).not.toContain('Echo Stun +0.5s')
  })

  it('does not advertise a draft or pick/ban phase that the live path lacks', () => {
    expect(readme).not.toMatch(/snake draft/i)
    expect(readme).not.toContain('Draft Phase')
    expect(readme).toContain('no pick/ban draft')
  })

  it('documents the real sell/talent/surrender command forms', () => {
    expect(readme).toContain('sell <item>')
    expect(readme).not.toContain('sell <slot>')
    expect(readme).toContain('talent <10|15|20|25> <left|right>')
    expect(readme).not.toContain('select_talent')
    expect(readme).toContain('surrender confirm')
  })

  it('quotes strip, burn, surrender and buyback numbers from the constants', () => {
    expect(readme).toContain(`at or below ${pct(STRIP_HP_THRESHOLD)} of its spawn INTEG`)
    expect(readme).toContain(`at or below ${pct(BURN_HP_THRESHOLD)} of its spawn INTEG`)
    expect(readme).toContain(`you keep ${pct(BURN_SCRIP_RATIO)}`)
    expect(readme).toContain(`${pct(SURRENDER_VOTE_THRESHOLD)} of a team's human players`)
    expect(readme).toContain(`from cycle ${SURRENDER_MIN_CYCLE}`)
    expect(readme).toContain(`${BUYBACK_BASE_COST} + ${BUYBACK_COST_PER_LEVEL}×level`)
    expect(readme).toContain(`${CYCLE_DURATION_MS / 1000}-second cycles`)
  })

  it('names no retired infrastructure as live, and no unenforced penalties', () => {
    expect(readme).not.toMatch(/redis/i)
    expect(readme).not.toContain('Low-Priority Queue')
    expect(readme).not.toContain('Leaver Penalties')
    // The one WebSocket/DigitalOcean mention is the "demolished" history line.
    for (const line of readme.split('\n').filter((l) => /websocket|digitalocean/i.test(l))) {
      expect(line.toLowerCase()).toMatch(/demolished|split|loop/)
    }
  })
})
