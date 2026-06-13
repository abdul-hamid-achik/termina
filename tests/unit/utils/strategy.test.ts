import { describe, it, expect } from 'vitest'
import {
  playerNetWorth,
  teamNetWorth,
  goldLead,
  formatGoldShort,
  ticksToClock,
  formatRoshan,
  formatRunes,
  formatAegis,
  visionSummary,
  dayNightReadout,
  sparkline,
} from '../../../app/utils/strategy'
import { ITEMS } from '../../../shared/constants/items'
import { ROSHAN_RESPAWN_TICKS, RUNE_DURATION_TICKS } from '../../../shared/constants/balance'
import { ZONES } from '../../../shared/constants/zones'

const [sampleItemId, sampleItem] = Object.entries(ITEMS)[0]!

describe('strategy: net worth', () => {
  it('values gold plus carried item costs', () => {
    expect(playerNetWorth({ gold: 100, items: [sampleItemId] })).toBe(100 + sampleItem.cost)
  })

  it('treats fogged players as unknown (0)', () => {
    expect(playerNetWorth({ gold: 500, items: [sampleItemId], fogged: true })).toBe(0)
  })

  it('ignores empty slots and unknown items', () => {
    expect(playerNetWorth({ gold: 50, items: [null, 'not_a_real_item', null] })).toBe(50)
  })

  it('sums a team', () => {
    const players = [
      { team: 'radiant', gold: 100, items: [] },
      { team: 'radiant', gold: 200, items: [] },
      { team: 'dire', gold: 999, items: [] },
    ]
    expect(teamNetWorth(players, 'radiant')).toBe(300)
  })
})

describe('strategy: gold lead', () => {
  it('reports the radiant lead', () => {
    expect(goldLead(5000, 3000)).toEqual({ leader: 'radiant', amount: 2000 })
  })
  it('reports the dire lead as a positive amount', () => {
    expect(goldLead(3000, 5200)).toEqual({ leader: 'dire', amount: 2200 })
  })
  it('reports a tie with no leader', () => {
    expect(goldLead(4000, 4000)).toEqual({ leader: null, amount: 0 })
  })
})

describe('strategy: formatting', () => {
  it('shortens gold over 1k', () => {
    expect(formatGoldShort(4200)).toBe('4.2k')
    expect(formatGoldShort(950)).toBe('950')
    expect(formatGoldShort(-1500)).toBe('-1.5k')
  })
  it('converts ticks to a clock', () => {
    expect(ticksToClock(0)).toBe('0:00')
    expect(ticksToClock(15)).toBe('1:00') // 15 ticks * 4s = 60s
    expect(ticksToClock(-5)).toBe('0:00')
  })
})

describe('strategy: roshan', () => {
  it('reports up with hp%', () => {
    const r = formatRoshan({ alive: true, hp: 2500, maxHp: 5000, deathTick: null }, 10)
    expect(r.status).toBe('up')
    expect(r.hpPct).toBe(50)
  })
  it('reports respawn countdown when dead', () => {
    const r = formatRoshan({ alive: false, hp: 0, maxHp: 5000, deathTick: 100 }, 120)
    expect(r.status).toBe('dead')
    expect(r.respawnIn).toBe(100 + ROSHAN_RESPAWN_TICKS - 120)
    expect(r.label).toContain(`${r.respawnIn}t`)
  })
  it('handles unknown roshan', () => {
    expect(formatRoshan(null, 5).status).toBe('unknown')
  })
})

describe('strategy: runes', () => {
  it('lists live runes with expiry', () => {
    const r = formatRunes([{ zone: 'rune-top', type: 'haste', tick: 50 }], 60)
    expect(r.live).toHaveLength(1)
    expect(r.live[0]!.expiresIn).toBe(50 + RUNE_DURATION_TICKS - 60)
  })
  it('drops expired runes and reports next spawn', () => {
    const r = formatRunes([{ zone: 'rune-top', type: 'haste', tick: 0 }], 55)
    expect(r.live).toHaveLength(0)
    expect(r.nextIn).toBe(5) // 55 % 60 -> next at 60
    expect(r.label).toContain('next')
  })
})

describe('strategy: aegis', () => {
  it('reports the carrier (from the aegis buff) + countdown', () => {
    const a = formatAegis(null, { name: 'Lina', ticksRemaining: 120 })
    expect(a.held).toBe(true)
    expect(a.holderName).toBe('Lina')
    expect(a.expiresIn).toBe(120)
    expect(a.label).toContain('Lina')
  })
  it('reports aegis waiting in the pit', () => {
    const a = formatAegis({ zone: 'roshan-pit', tick: 1, holderId: null })
    expect(a.held).toBe(false)
    expect(a.inPit).toBe(true)
    expect(a.label).toContain('pit')
  })
  it('reports no aegis', () => {
    const a = formatAegis(null)
    expect(a.held).toBe(false)
    expect(a.inPit).toBe(false)
  })
})

describe('strategy: vision', () => {
  it('summarises coverage and wards', () => {
    const v = visionSummary(
      ['a', 'b', 'c'],
      [{ expiryTick: 50 }, { expiryTick: 30 }, { expiryTick: 5 }],
      10,
    )
    expect(v.total).toBe(ZONES.length)
    expect(v.visible).toBe(3)
    expect(v.wardsActive).toBe(2) // expiry 5 is already past at tick 10, so it's dropped
    expect(v.nextWardExpiry).toBe(20) // 30 - 10 is the soonest still-active
  })
  it('handles no wards', () => {
    expect(visionSummary([], [], 0).nextWardExpiry).toBeNull()
  })
})

describe('strategy: day/night', () => {
  it('flags night with reduced vision meaning', () => {
    const n = dayNightReadout('night')
    expect(n.isNight).toBe(true)
    expect(n.meaning).toContain('reduced')
  })
  it('flags day', () => {
    expect(dayNightReadout('day').isNight).toBe(false)
  })
})

describe('strategy: sparkline', () => {
  it('renders a flat series as the lowest bar', () => {
    expect(sparkline([5, 5, 5])).toBe('▁▁▁')
  })
  it('renders a rising series ending high', () => {
    const s = sparkline([1, 2, 3, 4])
    expect(s).toHaveLength(4)
    expect(s.at(-1)).toBe('█')
    expect(s[0]).toBe('▁')
  })
  it('returns empty for empty input', () => {
    expect(sparkline([])).toBe('')
  })
})
