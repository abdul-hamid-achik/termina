import { describe, it, expect } from 'vitest'
import {
  playerNetWorth,
  teamNetWorth,
  goldLead,
  formatGoldShort,
  ticksToClock,
  formatTenant,
  formatCaches,
  formatBackup,
  visionSummary,
  dayNightReadout,
  sparkline,
  shortZone,
} from '~~/app/utils/strategy'
import { ITEMS } from '~~/shared/constants/items'
import {
  TENANT_RESPAWN_TICKS,
  CACHE_DURATION_TICKS,
  CACHE_INTERVAL_TICKS,
} from '~~/shared/constants/balance'
import { ZONES } from '~~/shared/constants/zones'

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
      { team: 'chaff', gold: 100, items: [] },
      { team: 'chaff', gold: 200, items: [] },
      { team: 'audit', gold: 999, items: [] },
    ]
    expect(teamNetWorth(players, 'chaff')).toBe(300)
  })
})

describe('strategy: gold lead', () => {
  it('reports the chaff lead', () => {
    expect(goldLead(5000, 3000)).toEqual({ leader: 'chaff', amount: 2000 })
  })
  it('reports the audit lead as a positive amount', () => {
    expect(goldLead(3000, 5200)).toEqual({ leader: 'audit', amount: 2200 })
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

describe('strategy: tenant', () => {
  it('reports up with hp%', () => {
    const r = formatTenant({ alive: true, integ: 2500, maxInteg: 5000, deathTick: null }, 10)
    expect(r.status).toBe('up')
    expect(r.hpPct).toBe(50)
  })
  it('reports respawn countdown when dead', () => {
    const r = formatTenant({ alive: false, integ: 0, maxInteg: 5000, deathTick: 100 }, 120)
    expect(r.status).toBe('dead')
    expect(r.respawnIn).toBe(100 + TENANT_RESPAWN_TICKS - 120)
    expect(r.label).toContain(`${r.respawnIn}c`)
  })
  it('handles unknown tenant', () => {
    expect(formatTenant(null, 5).status).toBe('unknown')
  })
  it('falls back to 100% hp when maxInteg is 0 (avoids divide-by-zero)', () => {
    const r = formatTenant({ alive: true, integ: 0, maxInteg: 0, deathTick: null }, 5)
    expect(r.status).toBe('up')
    expect(r.hpPct).toBe(100)
  })
  it('shows "respawning" for a dead tenant with no known death tick', () => {
    const r = formatTenant({ alive: false, integ: 0, maxInteg: 5000, deathTick: null }, 50)
    expect(r.status).toBe('dead')
    expect(r.respawnIn).toBe(0)
    expect(r.label).toBe('TENANT respawning')
  })
})

describe('strategy: caches', () => {
  it('lists live caches with expiry', () => {
    const r = formatCaches([{ zone: 'cache-top', type: 'haste', tick: 50 }], 60)
    expect(r.live).toHaveLength(1)
    expect(r.live[0]!.expiresIn).toBe(50 + CACHE_DURATION_TICKS - 60)
  })
  it('drops expired caches and reports next spawn', () => {
    const r = formatCaches([{ zone: 'cache-top', type: 'haste', tick: 0 }], 55)
    expect(r.live).toHaveLength(0)
    expect(r.nextIn).toBe(5) // 55 % 60 -> next at 60
    expect(r.label).toContain('next')
  })
  it('reports a full interval until the next spawn at an exact multiple', () => {
    // At an exact interval boundary the next window is a FULL interval away, not 0.
    const r = formatCaches([], CACHE_INTERVAL_TICKS)
    expect(r.nextIn).toBe(CACHE_INTERVAL_TICKS)
  })
})

describe('strategy: backup', () => {
  it('reports the carrier (from the backup buff) + countdown', () => {
    const a = formatBackup(null, { name: 'Lina', ticksRemaining: 120 })
    expect(a.held).toBe(true)
    expect(a.holderName).toBe('Lina')
    expect(a.expiresIn).toBe(120)
    expect(a.label).toContain('Lina')
  })
  it('reports backup waiting in the pit', () => {
    const a = formatBackup({ zone: 'hollow', tick: 1, holderId: null })
    expect(a.held).toBe(false)
    expect(a.inPit).toBe(true)
    expect(a.label).toContain('pit')
  })
  it('reports no backup', () => {
    const a = formatBackup(null)
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
  it('ignores non-finite values (NaN / Infinity)', () => {
    // Only the two finite samples (1, 3) are plotted → a 2-char low→high ramp.
    expect(sparkline([1, NaN, 3, Infinity])).toBe('▁█')
  })
})

describe('strategy: shortZone', () => {
  it('spaces out the id and upper-cases ice tiers', () => {
    expect(shortZone('mid-t1-chaff')).toBe('Coldstore T1 (CHAFF)')
    expect(shortZone('top-t2-audit')).toBe('Seawall T2 (AUDIT)')
  })
  it('leaves a plain zone id readable', () => {
    expect(shortZone('mid-river')).toBe('Coldstore Crossing')
  })
})
