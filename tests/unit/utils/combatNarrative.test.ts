import { describe, it, expect } from 'vitest'
import {
  eventToLine,
  buildCombatLines,
  deriveKillFeed,
  type NarrativeContext,
} from '../../../app/utils/combatNarrative'
import { collapseStructureDamage } from '../../../app/utils/combatLog'
import type { GameEvent } from '../../../shared/types/game'

const teams: Record<string, string> = {
  me: 'radiant',
  ally1: 'radiant',
  enemy1: 'dire',
  enemy2: 'dire',
}
const heroes: Record<string, string> = { me: 'thread', enemy1: 'null_ref', enemy2: 'regex' }

const ctx: NarrativeContext = {
  playerId: 'me',
  myTeam: 'radiant',
  entityLabel: (id) => (id === 'me' ? 'You' : String(id)),
  abilityLabel: (id) => `ability:${String(id)}`,
  teamOf: (id) => teams[String(id)],
  heroIdOf: (id) => heroes[String(id)],
  itemName: (id) => `Item(${id})`,
}

function ev(type: string, payload: Record<string, unknown>, tick = 1): GameEvent {
  return { tick, type, payload }
}

describe('eventToLine: salience', () => {
  it('marks incoming damage to me as mine-in', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'enemy1', targetId: 'me', amount: 80, damageType: 'physical' }),
      ctx,
    )!
    expect(line.salience).toBe('mine-in')
    expect(line.text).toContain('You')
    expect(line.text).toContain('80')
  })
  it('marks my outgoing damage as mine-out', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'me', targetId: 'enemy1', amount: 40, damageType: 'magical' }),
      ctx,
    )!
    expect(line.salience).toBe('mine-out')
  })
  it('marks teammate-involved as ally', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'enemy1', targetId: 'ally1', amount: 20, damageType: 'physical' }),
      ctx,
    )!
    expect(line.salience).toBe('ally')
  })
  it('marks pure bystander chip as world', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'enemy1', targetId: 'enemy2', amount: 20, damageType: 'physical' }),
      ctx,
    )!
    expect(line.salience).toBe('world')
  })
})

describe('eventToLine: structure damage collapses', () => {
  it('tags tower/core damage with a dedupKey + amount', () => {
    const line = eventToLine(
      ev('damage', {
        sourceId: 'me',
        targetId: 'tower_mid-t1-dire',
        amount: 70,
        damageType: 'physical',
      }),
      ctx,
    )!
    expect(line.dedupKey).toBe('dmg:me->tower_mid-t1-dire')
    expect(line.dmgAmount).toBe(70)
  })
})

describe('eventToLine: kills', () => {
  it('includes assisters and hero ids', () => {
    const line = eventToLine(
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: ['ally1'] }),
      ctx,
    )!
    expect(line.type).toBe('kill')
    expect(line.text).toContain('terminated')
    expect(line.text).toContain('assist')
    expect(line.killerHeroId).toBe('thread')
    expect(line.victimHeroId).toBe('null_ref')
  })
})

describe('eventToLine: gold noise suppression', () => {
  it('drops redundant last-hit gold lines', () => {
    expect(
      eventToLine(ev('gold_change', { playerId: 'me', amount: 40, reason: 'creep last hit' }), ctx),
    ).toBeNull()
    expect(
      eventToLine(ev('gold_change', { playerId: 'me', amount: 4, reason: 'passive' }), ctx),
    ).toBeNull()
  })
  it('keeps meaningful gold lines', () => {
    const line = eventToLine(
      ev('gold_change', { playerId: 'me', amount: -150, reason: 'buyback' }),
      ctx,
    )!
    expect(line.text).toContain('lost 150g')
  })
})

describe('eventToLine: previously-orphaned events get real text', () => {
  it('surfaces the power-spike message verbatim', () => {
    const line = eventToLine(
      ev('power_spike', {
        playerId: 'me',
        spikeType: 'level_6',
        message: 'You spiked at level 6!',
      }),
      ctx,
    )!
    expect(line.text).toBe('You spiked at level 6!')
    expect(line.type).toBe('objective')
  })
  it('narrates night/day as objective dividers', () => {
    expect(eventToLine(ev('night_falls', {}), ctx)!.text).toContain('NIGHT')
    expect(eventToLine(ev('day_breaks', {}), ctx)!.text).toContain('DAY')
  })
  it('narrates roshan, runes, aegis, wards', () => {
    expect(
      eventToLine(ev('roshan_killed', { killerTeam: 'radiant', goldAwarded: 600 }), ctx)!.text,
    ).toContain('Roshan')
    expect(
      eventToLine(ev('rune_picked', { playerId: 'me', zone: 'rune-top', runeType: 'haste' }), ctx)!
        .text,
    ).toContain('rune')
    expect(eventToLine(ev('aegis_picked', { playerId: 'me' }), ctx)!.text).toContain('Aegis')
    expect(
      eventToLine(
        ev('ward_placed', {
          playerId: 'me',
          zone: 'mid-river',
          team: 'radiant',
          wardType: 'observer',
        }),
        ctx,
      )!.text,
    ).toContain('ward')
  })
  it('confirms item buys and sells with the gold delta', () => {
    const buy = eventToLine(
      ev('item_purchased', { playerId: 'me', itemId: 'blink_module', cost: 500 }),
      ctx,
    )!
    expect(buy.type).toBe('gold')
    expect(buy.text).toContain('acquired')
    expect(buy.text).toContain('Item(blink_module)')
    expect(buy.text).toContain('-500')

    const sell = eventToLine(
      ev('item_sold', { playerId: 'me', itemId: 'iron_branch', refund: 25 }),
      ctx,
    )!
    expect(sell.type).toBe('gold')
    expect(sell.text).toContain('sold')
    expect(sell.text).toContain('Item(iron_branch)')
    expect(sell.text).toContain('+25')
  })
  it('keeps the exact victory phrasing for the core', () => {
    const line = eventToLine(ev('ancient_destroyed', { team: 'dire', killerTeam: 'radiant' }), ctx)!
    expect(line.type).toBe('victory')
    expect(line.text).toBe('Radiant destroyed the Dire Core!')
    expect(line.text).not.toContain('tower')
  })
  it('suppresses internal/non-narrative events', () => {
    expect(eventToLine(ev('cooldown_used', { playerId: 'me', abilityId: 'q' }), ctx)).toBeNull()
    expect(eventToLine(ev('tower_invulnerable', { zone: 'mid-t1-rad' }), ctx)).toBeNull()
    expect(eventToLine(ev('totally_unknown_event', {}), ctx)).toBeNull()
  })
})

describe('buildCombatLines', () => {
  it('maps, suppresses, and collapses structure chip', () => {
    const events: GameEvent[] = [
      ev(
        'damage',
        { sourceId: 'me', targetId: 'tower_mid-t1-dire', amount: 70, damageType: 'physical' },
        1,
      ),
      ev(
        'damage',
        { sourceId: 'me', targetId: 'tower_mid-t1-dire', amount: 70, damageType: 'physical' },
        2,
      ),
      ev('gold_change', { playerId: 'me', amount: 40, reason: 'creep last hit' }, 2),
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }, 3),
    ]
    const lines = buildCombatLines(events, ctx, collapseStructureDamage)
    // two tower hits collapse to one running line; the last-hit gold is dropped; kill remains
    expect(lines).toHaveLength(2)
    const tower = lines.find((l) => l.dedupKey)!
    expect(tower.count).toBe(2)
    expect(tower.text).toContain('×2')
    expect(lines.some((l) => l.type === 'kill')).toBe(true)
  })
})

describe('deriveKillFeed', () => {
  it('flags first blood on the first kill', () => {
    const feed = deriveKillFeed(
      [ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }, 5)],
      ctx,
    )
    expect(feed[0]!.firstBlood).toBe(true)
    expect(feed[0]!.text).toContain('FIRST BLOOD')
  })

  it('chains a double kill within the window', () => {
    const feed = deriveKillFeed(
      [
        ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }, 5),
        ev('kill', { killerId: 'me', victimId: 'enemy2', assisters: [] }, 7),
      ],
      ctx,
    )
    expect(feed[1]!.multiKill).toBe(2)
    expect(feed[1]!.text).toContain('DOUBLE KILL')
  })

  it('does not chain kills outside the window', () => {
    const feed = deriveKillFeed(
      [
        ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }, 5),
        ev('kill', { killerId: 'me', victimId: 'enemy2', assisters: [] }, 20),
      ],
      ctx,
    )
    expect(feed[1]!.multiKill).toBeUndefined()
  })

  it('marks a shutdown when the victim was on a streak', () => {
    const events: GameEvent[] = [
      ev('kill', { killerId: 'enemy1', victimId: 'ally1', assisters: [] }, 1),
      ev('kill', { killerId: 'enemy1', victimId: 'me', assisters: [] }, 3),
      ev('kill', { killerId: 'enemy1', victimId: 'ally1', assisters: [] }, 5),
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }, 30), // enemy1 had a 3-streak
    ]
    const feed = deriveKillFeed(events, ctx)
    expect(feed.at(-1)!.shutdown).toBe(true)
    expect(feed.at(-1)!.text).toContain('SHUTDOWN')
  })

  it('emits tower / roshan / core headline entries', () => {
    const feed = deriveKillFeed(
      [
        ev('tower_kill', { killerTeam: 'radiant', team: 'dire', zone: 'mid-t1-dire' }, 1),
        ev('roshan_killed', { killerTeam: 'radiant', goldAwarded: 600 }, 2),
        ev('ancient_destroyed', { killerTeam: 'radiant', team: 'dire' }, 3),
      ],
      ctx,
    )
    expect(feed.map((f) => f.category)).toEqual(['tower', 'roshan', 'core'])
    expect(feed[2]!.text).toContain('CORE DUMPED')
  })

  it('escalates a 3-kill chain within the window to TRIPLE KILL', () => {
    const feed = deriveKillFeed(
      [
        ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }, 5),
        ev('kill', { killerId: 'me', victimId: 'enemy2', assisters: [] }, 7),
        ev('kill', { killerId: 'me', victimId: 'ally1', assisters: [] }, 9),
      ],
      ctx,
    )
    expect(feed.at(-1)!.multiKill).toBe(3)
    expect(feed.at(-1)!.text).toContain('TRIPLE KILL')
  })

  it('reports an ongoing streak (not a multi-kill) for spread-out kills', () => {
    const feed = deriveKillFeed(
      [
        ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }, 5),
        ev('kill', { killerId: 'me', victimId: 'enemy2', assisters: [] }, 30),
        ev('kill', { killerId: 'me', victimId: 'ally1', assisters: [] }, 60),
      ],
      ctx,
    )
    const last = feed.at(-1)!
    expect(last.multiKill).toBeUndefined()
    expect(last.streak).toBe(3)
    expect(last.text).toContain('KILLING SPREE')
  })
})

describe('eventToLine: more orphaned events', () => {
  it('narrates roshan_killed without a killerTeam as a generic fall', () => {
    const line = eventToLine(ev('roshan_killed', {}), ctx)!
    expect(line.text).toContain('Roshan has fallen')
    expect(line.type).toBe('objective')
  })

  it('dedups Roshan chip damage', () => {
    const line = eventToLine(ev('roshan_damage', { damage: 120, hp: 4000, maxHp: 5000 }), ctx)!
    expect(line.dedupKey).toBe('dmg:roshan')
    expect(line.dmgAmount).toBe(120)
  })
})

describe('actorSalience for single-actor events', () => {
  it('is ally for a teammate, world for an enemy, mine-out for me', () => {
    expect(eventToLine(ev('level_up', { playerId: 'ally1', newLevel: 6 }), ctx)!.salience).toBe(
      'ally',
    )
    expect(eventToLine(ev('level_up', { playerId: 'enemy1', newLevel: 6 }), ctx)!.salience).toBe(
      'world',
    )
    expect(eventToLine(ev('level_up', { playerId: 'me', newLevel: 6 }), ctx)!.salience).toBe(
      'mine-out',
    )
  })
})

describe('eventToLine: narration coverage for every event type', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['death', { playerId: 'enemy1', respawnTick: 5 }, 'terminated'],
    ['heal', { sourceId: 'me', targetId: 'ally1', amount: 50 }, 'restored 50'],
    ['creep_lasthit', { playerId: 'me', creepType: 'melee', goldAwarded: 40 }, 'last-hit'],
    ['creep_deny', { playerId: 'me', creepType: 'melee' }, 'denied'],
    ['ability_used', { playerId: 'me', abilityId: 'q', targetId: 'enemy1' }, 'cast'],
    ['enemy_missing', { playerId: 'enemy1', lastSeenZone: 'mid-river' }, 'MISSING'],
    ['item_purchased', { playerId: 'me', itemId: 'dagon', cost: 2700 }, 'acquired'],
    ['neutral_killed', { playerId: 'me', neutralType: 'kobold' }, 'kobold camp'],
    ['aegis_used', { playerId: 'me' }, 'reincarnated'],
    ['talent_selected', { playerId: 'me', talentName: '+250 HP' }, 'learned +250 HP'],
    ['teleport_complete', { playerId: 'me', destination: 'mid-river' }, 'teleported to mid-river'],
    ['trap_triggered', { owner: 'me', targetId: 'enemy1', zone: 'mid-river', damage: 100 }, 'trap'],
    ['teleport_cancelled', { playerId: 'me', reason: 'stunned' }, 'cancelled'],
    ['glyph_used', { team: 'radiant' }, 'Glyph'],
    ['surrender_vote', { team: 'radiant', votesFor: 2, votesNeeded: 3 }, '2/3'],
    ['surrendered', { team: 'dire', winner: 'radiant' }, 'surrendered'],
    ['roshan_respawn', {}, 'respawned'],
  ]

  it.each(cases)('narrates %s with a matching line', (type, payload, expected) => {
    const line = eventToLine(ev(type, payload), ctx)
    expect(line).not.toBeNull()
    expect(line!.text).toContain(expected)
  })

  it('narrates the next_hop return-shadow teleport variant', () => {
    const line = eventToLine(
      ev('teleport_complete', { playerId: 'me', destination: 'mid-river', source: 'next_hop' }),
      ctx,
    )
    expect(line!.text).toContain('return shadow')
  })

  it('narrates both spell_blocked sources distinctly', () => {
    const lotus = eventToLine(
      ev('spell_blocked', {
        source: 'lotus_orb',
        targetId: 'enemy1',
        casterId: 'me',
        reflected: 50,
      }),
      ctx,
    )
    expect(lotus!.text).toContain('Lotus Orb')
    const linkens = eventToLine(
      ev('spell_blocked', { source: 'linkens_sphere', targetId: 'enemy1', casterId: 'me' }),
      ctx,
    )
    expect(linkens!.text).toContain("Linken's Sphere")
  })

  it('produces no line for internal / non-narrative events', () => {
    for (const t of [
      'contest_lasthit',
      'glyph_on_cooldown',
      'tower_invulnerable',
      'cooldown_used',
    ]) {
      expect(eventToLine(ev(t, {}), ctx)).toBeNull()
    }
  })
})
