import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  eventToLine,
  buildCombatLines,
  deriveKillFeed,
  type NarrativeContext,
} from '~~/app/utils/combatNarrative'
import {
  collapseStructureDamage,
  buildTickStoryView,
  terminalLabel,
  isStructureTarget,
  teamLabel,
  type CombatLine,
} from '~~/app/utils/combatLog'
import type { GameEvent } from '~~/shared/types/game'

const teams: Record<string, string> = {
  me: 'chaff',
  ally1: 'chaff',
  enemy1: 'audit',
  enemy2: 'audit',
}
const heroes: Record<string, string> = { me: 'thread', enemy1: 'null_ref', enemy2: 'regex' }

const ctx: NarrativeContext = {
  playerId: 'me',
  myTeam: 'chaff',
  entityLabel: (id) => (id === 'me' ? 'You' : String(id)),
  abilityLabel: (id) => `ability:${String(id)}`,
  teamOf: (id) => teams[String(id)],
  heroIdOf: (id) => heroes[String(id)],
  itemName: (id) => `Item(${id})`,
}

function ev(type: string, payload: Record<string, unknown>, cycle = 1): GameEvent {
  return { cycle, type, payload }
}

describe('eventToLine: salience', () => {
  it('marks incoming damage to me as mine-in', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'enemy1', targetId: 'me', amount: 80, damageType: 'kinetic' }),
      ctx,
    )!
    expect(line.salience).toBe('mine-in')
    expect(line.text).toContain('You')
    expect(line.text).toContain('80')
  })
  it('marks my outgoing damage as mine-out', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'me', targetId: 'enemy1', amount: 40, damageType: 'code' }),
      ctx,
    )!
    expect(line.salience).toBe('mine-out')
  })
  it('marks teammate-involved as ally', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'enemy1', targetId: 'ally1', amount: 20, damageType: 'kinetic' }),
      ctx,
    )!
    expect(line.salience).toBe('ally')
  })
  it('marks pure bystander chip as world', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'enemy1', targetId: 'enemy2', amount: 20, damageType: 'kinetic' }),
      ctx,
    )!
    expect(line.salience).toBe('world')
  })
})

describe('eventToLine: double cast proc', () => {
  it('renders a loud DOUBLE CAST line for my proc (mine-out)', () => {
    const line = eventToLine(ev('double_cast', { playerId: 'me', abilityId: 'echo-q' }), ctx)!
    expect(line.text).toContain('DOUBLE CAST')
    expect(line.text).toContain('ability:echo-q')
    expect(line.salience).toBe('mine-out')
  })
  it('renders an enemy double cast as world salience', () => {
    const line = eventToLine(
      ev('double_cast', { playerId: 'enemy1', abilityId: 'null_ref-q' }),
      ctx,
    )!
    expect(line.text).toContain('DOUBLE CAST')
    expect(line.salience).toBe('world')
  })
})

describe('eventToLine: structure damage collapses', () => {
  it('tags ice/core damage with a dedupKey + amount', () => {
    const line = eventToLine(
      ev('damage', {
        sourceId: 'me',
        targetId: 'ice_coldstore-t1-audit',
        amount: 70,
        damageType: 'kinetic',
      }),
      ctx,
    )!
    expect(line.dedupKey).toBe('dmg:me->ice_coldstore-t1-audit')
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

  it('calls out a SHUTDOWN when the victim was on a streak', () => {
    const line = eventToLine(
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [], victimStreak: 4 }),
      ctx,
    )!
    expect(line.text).toContain('SHUTDOWN')
    expect(line.text).toContain('4-kill streak')
  })

  it('names the killer’s spree at 3+ when the victim was not fed', () => {
    const spree = eventToLine(
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [], killerStreak: 3 }),
      ctx,
    )!
    expect(spree.text).toContain('KILLING SPREE')

    // 7 is 'WICKED SICK' — the line flair and the kill-feed banner share the
    // same STREAK_LABEL, so this must match deriveKillFeed (not a separate table).
    const seven = eventToLine(
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [], killerStreak: 7 }),
      ctx,
    )!
    expect(seven.text).toContain('WICKED SICK')

    // 9 = GODLIKE (top named tier); 10+ stays at GODLIKE rather than unlabeled.
    const godlike = eventToLine(
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [], killerStreak: 12 }),
      ctx,
    )!
    expect(godlike.text).toContain('GODLIKE')
  })

  it('a SHUTDOWN takes precedence over the killer spree', () => {
    const line = eventToLine(
      ev('kill', {
        killerId: 'me',
        victimId: 'enemy1',
        assisters: [],
        victimStreak: 5,
        killerStreak: 4,
      }),
      ctx,
    )!
    expect(line.text).toContain('SHUTDOWN')
    expect(line.text).not.toContain('DOMINATING')
  })

  it('an ordinary kill (no streaks) has no flair', () => {
    const line = eventToLine(
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }),
      ctx,
    )!
    expect(line.text).not.toContain('SHUTDOWN')
    expect(line.text).not.toContain('>>')
  })
})

describe('eventToLine: scrip noise suppression', () => {
  it('drops redundant last-hit scrip lines', () => {
    expect(
      eventToLine(ev('scrip_change', { playerId: 'me', amount: 40, reason: 'wave last hit' }), ctx),
    ).toBeNull()
    expect(
      eventToLine(ev('scrip_change', { playerId: 'me', amount: 4, reason: 'passive' }), ctx),
    ).toBeNull()
  })
  it('keeps meaningful scrip lines', () => {
    const line = eventToLine(
      ev('scrip_change', { playerId: 'me', amount: -150, reason: 'buyback' }),
      ctx,
    )!
    expect(line.text).toContain('lost 150sc')
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
  it('narrates tenant, caches, backup, wards', () => {
    expect(
      eventToLine(ev('tenant_killed', { killerTeam: 'chaff', scripAwarded: 600 }), ctx)!.text,
    ).toContain('Tenant')
    expect(
      eventToLine(
        ev('cache_picked', { playerId: 'me', zone: 'cache-seawall', cacheType: 'haste' }),
        ctx,
      )!.text,
    ).toContain('cache')
    expect(eventToLine(ev('backup_picked', { playerId: 'me' }), ctx)!.text).toContain('Backup')
    expect(
      eventToLine(
        ev('ward_placed', {
          playerId: 'me',
          zone: 'coldstore-cross',
          team: 'chaff',
          wardType: 'camtap',
        }),
        ctx,
      )!.text,
      // The device's display label, not the raw wardType — WARD_LABELS was keyed
      // observer/sentry while the engine emits camtap/sniffer, so every lookup
      // missed and the feed printed the raw id.
    ).toContain('CAMTAP')
  })
  it('confirms item buys and sells with the scrip delta', () => {
    const buy = eventToLine(
      ev('item_purchased', { playerId: 'me', itemId: 'jump_shunt', cost: 500 }),
      ctx,
    )!
    expect(buy.type).toBe('scrip')
    expect(buy.text).toContain('acquired')
    expect(buy.text).toContain('Item(jump_shunt)')
    expect(buy.text).toContain('-500')

    const sell = eventToLine(
      ev('item_sold', { playerId: 'me', itemId: 'scrap_lot', refund: 25 }),
      ctx,
    )!
    expect(sell.type).toBe('scrip')
    expect(sell.text).toContain('sold')
    expect(sell.text).toContain('Item(scrap_lot)')
    expect(sell.text).toContain('+25')
  })
  it('keeps the exact victory phrasing for the core', () => {
    const line = eventToLine(ev('terminal_destroyed', { team: 'audit', killerTeam: 'chaff' }), ctx)!
    expect(line.type).toBe('victory')
    expect(line.text).toBe('CHAFF destroyed the AUDIT Terminal!')
    expect(line.text).not.toContain('ice')
  })
  it('suppresses internal/non-narrative events', () => {
    expect(eventToLine(ev('cooldown_used', { playerId: 'me', abilityId: 'q' }), ctx)).toBeNull()
    expect(eventToLine(ev('totally_unknown_event', {}), ctx)).toBeNull()
  })

  it('explains the two failures that used to be emitted then silently dropped', () => {
    // Both are the server's answer to an action the player just spent a cycle
    // on — swallowing them left the cycle looking like it did nothing at all.
    const invuln = eventToLine(ev('ice_invulnerable', { zone: 'coldstore-t1-chaff' }), ctx)!
    expect(invuln.text).toContain('Harden')
    expect(invuln.text).toContain('coldstore-t1-chaff')

    const cd = eventToLine(ev('harden_on_cooldown', { playerId: 'me', remainingTicks: 120 }), ctx)!
    expect(cd.text).toContain('120c')
    expect(cd.salience).toBe('mine-out')
  })
})

describe('buildCombatLines', () => {
  it('maps, suppresses, and collapses structure chip', () => {
    const events: GameEvent[] = [
      ev(
        'damage',
        { sourceId: 'me', targetId: 'ice_coldstore-t1-audit', amount: 70, damageType: 'kinetic' },
        1,
      ),
      ev(
        'damage',
        { sourceId: 'me', targetId: 'ice_coldstore-t1-audit', amount: 70, damageType: 'kinetic' },
        2,
      ),
      ev('scrip_change', { playerId: 'me', amount: 40, reason: 'wave last hit' }, 2),
      ev('kill', { killerId: 'me', victimId: 'enemy1', assisters: [] }, 3),
    ]
    const lines = buildCombatLines(events, ctx, collapseStructureDamage)
    // two ice hits collapse to one running line; the last-hit scrip is dropped; kill remains
    expect(lines).toHaveLength(2)
    const ice = lines.find((l) => l.dedupKey)!
    expect(ice.count).toBe(2)
    expect(ice.text).toContain('×2')
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

  it('emits ice / tenant / core headline entries', () => {
    const feed = deriveKillFeed(
      [
        ev('ice_kill', { killerTeam: 'chaff', team: 'audit', zone: 'coldstore-t1-audit' }, 1),
        ev('tenant_killed', { killerTeam: 'chaff', scripAwarded: 600 }, 2),
        ev('terminal_destroyed', { killerTeam: 'chaff', team: 'audit' }, 3),
      ],
      ctx,
    )
    expect(feed.map((f) => f.category)).toEqual(['ice', 'tenant', 'terminal'])
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
  it('narrates tenant_killed without a killerTeam as a generic fall', () => {
    const line = eventToLine(ev('tenant_killed', {}), ctx)!
    expect(line.text).toContain('Tenant has fallen')
    expect(line.type).toBe('objective')
  })

  it('dedups Tenant chip damage', () => {
    const line = eventToLine(
      ev('tenant_damage', { damage: 120, integ: 4000, maxInteg: 5000 }),
      ctx,
    )!
    expect(line.dedupKey).toBe('dmg:tenant')
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

describe('eventToLine: death grammar', () => {
  it('uses "You were" for the local player, "X was" for everyone else', () => {
    expect(eventToLine(ev('death', { playerId: 'me', respawnCycle: 5 }), ctx)!.text).toMatch(
      /^You were terminated/,
    )
    expect(eventToLine(ev('death', { playerId: 'me', respawnCycle: 5 }), ctx)!.text).not.toMatch(
      /You was/,
    )
    expect(eventToLine(ev('death', { playerId: 'enemy1', respawnCycle: 5 }), ctx)!.text).toMatch(
      /enemy1 was terminated/,
    )
  })
})

describe('eventToLine: narration coverage for every event type', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['death', { playerId: 'enemy1', respawnCycle: 5 }, 'terminated'],
    ['heal', { sourceId: 'me', targetId: 'ally1', amount: 50 }, 'restored 50'],
    ['wave_strip', { playerId: 'me', waveType: 'line', scripAwarded: 40 }, 'last-hit'],
    ['wave_burn', { playerId: 'me', waveType: 'line' }, 'burned'],
    ['ability_used', { playerId: 'me', abilityId: 'q', targetId: 'enemy1' }, 'cast'],
    ['item_purchased', { playerId: 'me', itemId: 'burnout', cost: 2700 }, 'acquired'],
    ['neutral_killed', { playerId: 'me', neutralType: 'stub' }, 'stub camp'],
    ['backup_used', { playerId: 'me' }, 'reincarnated'],
    ['talent_selected', { playerId: 'me', talentName: '+250 INTEG' }, 'learned +250 INTEG'],
    [
      'teleport_complete',
      { playerId: 'me', destination: 'coldstore-cross' },
      'teleported to coldstore-cross',
    ],
    [
      'trap_triggered',
      { owner: 'me', targetId: 'enemy1', zone: 'coldstore-cross', damage: 100 },
      'trap',
    ],
    ['teleport_cancelled', { playerId: 'me', reason: 'stunned' }, 'cancelled'],
    ['harden_used', { team: 'chaff' }, 'Harden'],
    ['surrender_vote', { team: 'chaff', votesFor: 2, votesNeeded: 3 }, '2/3'],
    ['surrendered', { team: 'audit', winner: 'chaff' }, 'surrendered'],
    ['tenant_respawn', {}, 'respawned'],
    [
      'afk_takeover',
      { playerId: 'enemy1', team: 'audit', message: 'went AFK — a bot has taken over' },
      'a bot has taken over',
    ],
  ]

  it.each(cases)('narrates %s with a matching line', (type, payload, expected) => {
    const line = eventToLine(ev(type, payload), ctx)
    expect(line).not.toBeNull()
    expect(line!.text).toContain(expected)
  })

  it('narrates the next_hop return-shadow teleport variant', () => {
    const line = eventToLine(
      ev('teleport_complete', {
        playerId: 'me',
        destination: 'coldstore-cross',
        source: 'next_hop',
      }),
      ctx,
    )
    expect(line!.text).toContain('return shadow')
  })

  it('narrates both spell_blocked sources distinctly', () => {
    const lotus = eventToLine(
      ev('spell_blocked', {
        source: 'mirror_shell',
        targetId: 'enemy1',
        casterId: 'me',
        reflected: 50,
      }),
      ctx,
    )
    expect(lotus!.text).toContain('Mirror Shell')
    expect(lotus!.text).toContain('reflected')
    expect(lotus!.text).toContain('50') // the reflected damage is shown (-50)

    const linkens = eventToLine(
      ev('spell_blocked', { source: 'intercept_shell', targetId: 'enemy1', casterId: 'me' }),
      ctx,
    )
    expect(linkens!.text).toContain('Intercept Shell')
    expect(linkens!.text).toContain('blocked')
    expect(linkens!.text).not.toContain('reflected') // a block isn't a reflect
  })

  it('produces no line for internal / non-narrative events', () => {
    expect(eventToLine(ev('cooldown_used', {}), ctx)).toBeNull()
  })
})

describe('eventToLine: crowd control', () => {
  it('narrates a disable landing on me, loud, with the engine duration', () => {
    const line = eventToLine(
      ev('status_applied', {
        sourceId: 'enemy1',
        targetId: 'me',
        status: 'root',
        cyclesRemaining: 1,
      }),
      ctx,
    )!
    expect(line.text).toBe('enemy1 ROOTED You (1c)')
    // mine-in is what the feed renders loudest and sorts to the top of the beat.
    expect(line.salience).toBe('mine-in')
  })

  it('renders each disable id under its player-facing name', () => {
    const named = (status: string) =>
      eventToLine(
        ev('status_applied', { sourceId: 'me', targetId: 'enemy1', status, cyclesRemaining: 2 }),
        ctx,
      )!.text
    expect(named('stun')).toContain('STUNNED')
    expect(named('silence')).toContain('SILENCED')
    expect(named('hex')).toContain('HEXED')
    expect(named('taunt')).toContain('TAUNTED')
    // Unknown ids still read as words rather than leaking a raw engine id.
    expect(named('some_new_disable')).toContain('SOME NEW DISABLE')
  })

  it('omits the duration when the engine reports none', () => {
    const line = eventToLine(
      ev('status_applied', { sourceId: 'me', targetId: 'enemy1', status: 'stun' }),
      ctx,
    )!
    expect(line.text).not.toContain('(')
  })
})

describe('eventToLine: cause-before-effect salience', () => {
  it('ranks an enemy cast aimed at me as mine-in, not bystander noise', () => {
    // The story view sorts a cycle by salience, so an actor-only salience put the
    // enemy's spell (world) BELOW the damage it caused (mine-in) — the log
    // literally printed the effect before the cause.
    const line = eventToLine(
      ev('ability_used', { playerId: 'enemy1', abilityId: 'q', targetId: 'me' }),
      ctx,
    )!
    expect(line.salience).toBe('mine-in')
  })

  it('orders the beat cause-first once the server emits the cast first', () => {
    // The end-to-end shape of the fix: ActionResolver splices ability_used
    // ahead of its own damage, and this salience puts both in the same
    // priority band so the stable sort preserves that order.
    const lines = buildCombatLines(
      [
        ev('ability_used', { playerId: 'enemy1', abilityId: 'q', targetId: 'me' }, 7),
        ev('damage', { sourceId: 'enemy1', targetId: 'me', amount: 106, damageType: 'code' }, 7),
      ],
      ctx,
      collapseStructureDamage,
    )
    expect(buildTickStoryView(lines).map((l) => l.type)).toEqual(['ability', 'damage'])
  })

  it('keeps my own cast as mine-out and an unrelated enemy cast as world', () => {
    expect(eventToLine(ev('ability_used', { playerId: 'me', abilityId: 'q' }), ctx)!.salience).toBe(
      'mine-out',
    )
    expect(
      eventToLine(
        ev('ability_used', { playerId: 'enemy1', abilityId: 'q', targetId: 'enemy2' }),
        ctx,
      )!.salience,
    ).toBe('world')
  })
})

/**
 * The drift guard. Every gap this wave closed (kill scrip, status effects, the
 * two suppressed failures) was the same defect: an event the engine emits that
 * the narrative layer silently forgets. Enumerate the union from its own source
 * so a new event type must either render a line or be added to the allow-list
 * below — no third option.
 */
describe('narration drift guard', () => {
  const eventsSource = readFileSync(
    fileURLToPath(new URL('../../../server/game/protocol/events.ts', import.meta.url)),
    'utf8',
  )

  /** Tags of every interface named in the `GameEngineEvent` union. */
  function unionTags(): string[] {
    const tagOf = new Map<string, string>()
    for (const m of eventsSource.matchAll(/export interface (\w+)\s*\{([\s\S]*?)\n\}/g)) {
      const tag = /_tag:\s*'([^']+)'/.exec(m[2]!)?.[1]
      if (tag) tagOf.set(m[1]!, tag)
    }
    const union = /export type GameEngineEvent =([\s\S]*?)\n\n/.exec(eventsSource)?.[1]
    expect(union, 'could not locate the GameEngineEvent union').toBeTruthy()
    const tags = [...union!.matchAll(/\|\s*(\w+)/g)].map((m) => {
      const tag = tagOf.get(m[1]!)
      expect(tag, `union member ${m[1]} has no _tag literal`).toBeTruthy()
      return tag!
    })
    expect(tags.length).toBeGreaterThan(30)
    return [...new Set(tags)]
  }

  /**
   * Events that intentionally produce no line. Adding to this list is a
   * deliberate product decision — it is not a place to park an oversight.
   */
  const SUPPRESSED = new Set([
    // Bookkeeping twin of ability_used; the cooldown is already on the slot.
    'cooldown_used',
  ])

  /** Superset payload — every field any renderer reads, with values that are
   *  valid for whichever event consumes them. */
  const PROBE: Record<string, unknown> = {
    playerId: 'me',
    sourceId: 'enemy1',
    targetId: 'me',
    casterId: 'enemy1',
    killerId: 'me',
    victimId: 'enemy1',
    assisters: [],
    owner: 'enemy1',
    team: 'chaff',
    killerTeam: 'chaff',
    winner: 'chaff',
    zone: 'coldstore-cross',
    destination: 'coldstore-cross',
    amount: 10,
    damage: 10,
    scripAwarded: 40,
    cost: 100,
    refund: 25,
    // A reason the client does NOT treat as farm noise — scrip suppression is
    // content-based (see REDUNDANT_GOLD), never type-based.
    reason: 'hero kill',
    abilityId: 'q',
    itemId: 'burnout',
    talentName: 'Sharp Edge',
    message: 'power spike',
    status: 'stun',
    cyclesRemaining: 2,
    remainingTicks: 12,
    newLevel: 6,
    waveType: 'line',
    neutralType: 'stub',
    cacheType: 'haste',
    wardType: 'camtap',
    damageType: 'kinetic',
    integ: 100,
    maxInteg: 200,
    votesFor: 1,
    votesNeeded: 3,
    source: 'intercept_shell',
    respawnCycle: 5,
    heroId: 'echo',
  }

  it('every GameEngineEvent renders a line or is explicitly suppressed', () => {
    const missing: string[] = []
    for (const tag of unionTags()) {
      const line = eventToLine(ev(tag, PROBE), ctx)
      if (SUPPRESSED.has(tag)) {
        expect(line, `${tag} is allow-listed as suppressed but rendered a line`).toBeNull()
      } else if (!line || line.text.trim() === '') {
        missing.push(tag)
      }
    }
    expect(missing, `events with no combat-log line: ${missing.join(', ')}`).toEqual([])
  })

  it('no line leaks a raw payload dump or an unresolved id', () => {
    for (const tag of unionTags()) {
      const line = eventToLine(ev(tag, PROBE), ctx)
      if (!line) continue
      expect(line.text, `${tag} renders raw JSON`).not.toContain('{')
      expect(line.text, `${tag} renders [object Object]`).not.toContain('[object')
      expect(line.text, `${tag} renders "undefined"`).not.toContain('undefined')
    }
  })
})

describe('combatLog label helpers', () => {
  it('terminalLabel resolves the team Terminal, or null for non-terminal ids', () => {
    expect(terminalLabel('terminal_chaff')).toBe('the CHAFF Terminal')
    expect(terminalLabel('terminal_audit')).toBe('the AUDIT Terminal')
    // Unknown team falls back to a readable label rather than null/crash.
    expect(terminalLabel('terminal_neutral')).toBe('the neutral Terminal')
    expect(terminalLabel('ice_coldstore-t1-chaff')).toBeNull()
    expect(terminalLabel('hero_echo')).toBeNull()
  })

  it('isStructureTarget is true only for ice/terminal string ids', () => {
    expect(isStructureTarget('ice_coldstore-t1-chaff')).toBe(true)
    expect(isStructureTarget('terminal_audit')).toBe(true)
    expect(isStructureTarget('hero_echo')).toBe(false)
    expect(isStructureTarget('creep_3')).toBe(false)
    // Non-string ids (null/undefined/number) are not structures.
    expect(isStructureTarget(null)).toBe(false)
    expect(isStructureTarget(undefined)).toBe(false)
    expect(isStructureTarget(42)).toBe(false)
  })

  it('teamLabel reads the faction label from the world lexicon', () => {
    expect(teamLabel('chaff')).toBe('CHAFF')
    expect(teamLabel('audit')).toBe('AUDIT')
    // Unknown ids degrade loudly (uppercased), never silently title-cased.
    expect(teamLabel('quorum')).toBe('QUORUM')
  })
})

describe('collapseStructureDamage (direct)', () => {
  const fmt = ({ baseText, count, total }: { baseText: string; count: number; total: number }) =>
    `${baseText} ×${count} (${total})`

  it('collapses consecutive same-key lines, accumulating count + total', () => {
    const lines: CombatLine[] = [
      { cycle: 1, text: 'You hit the Terminal', type: 'damage', dedupKey: 'k', dmgAmount: 70 },
      { cycle: 2, text: 'You hit the Terminal', type: 'damage', dedupKey: 'k', dmgAmount: 50 },
    ]
    const out = collapseStructureDamage(lines, fmt)
    expect(out).toHaveLength(1)
    expect(out[0]!.count).toBe(2)
    expect(out[0]!.cycle).toBe(2) // keeps the latest cycle
    expect(out[0]!.text).toBe('You hit the Terminal ×2 (120)')
    // internal bookkeeping fields are stripped from the result
    expect('total' in out[0]!).toBe(false)
    expect('baseText' in out[0]!).toBe(false)
  })

  it('treats a missing dmgAmount as 0 when accumulating', () => {
    const lines: CombatLine[] = [
      { cycle: 1, text: 'hit', type: 'damage', dedupKey: 'k' },
      { cycle: 2, text: 'hit', type: 'damage', dedupKey: 'k' },
    ]
    expect(collapseStructureDamage(lines, fmt)[0]!.text).toBe('hit ×2 (0)')
  })

  it('passes non-dedup lines through and a gap resets the run', () => {
    const lines: CombatLine[] = [
      { cycle: 1, text: 'A', type: 'damage', dedupKey: 'k', dmgAmount: 10 },
      { cycle: 2, text: 'kill', type: 'kill' }, // no dedupKey → passthrough + gap
      { cycle: 3, text: 'A', type: 'damage', dedupKey: 'k', dmgAmount: 10 },
    ]
    const out = collapseStructureDamage(lines, fmt)
    expect(out).toHaveLength(3) // the gap prevents collapsing across it
  })
})

describe('eventToLine: remaining event-type lines', () => {
  const line = (type: string, payload: Record<string, unknown>) =>
    eventToLine(ev(type, payload), ctx)

  it('heal → restored line', () => {
    expect(line('heal', { sourceId: 'me', targetId: 'ally1', amount: 50 })!.text).toContain(
      'restored 50 to ally1',
    )
  })
  it('wave_strip → last-hit with gold', () => {
    expect(
      line('wave_strip', { playerId: 'me', waveType: 'line', scripAwarded: 40 })!.text,
    ).toContain('last-hit a line wave (+40sc)')
  })
  it('wave_burn → burn line', () => {
    expect(line('wave_burn', { playerId: 'me', waveType: 'sweep' })!.text).toContain(
      'burned a sweep wave',
    )
  })
  it('ability_used → cast line with and without a target', () => {
    expect(
      line('ability_used', { playerId: 'me', abilityId: 'q', targetId: 'enemy1' })!.text,
    ).toContain('cast ability:q on enemy1')
    const noTarget = line('ability_used', { playerId: 'me', abilityId: 'w' })!.text
    expect(noTarget).toContain('cast ability:w')
    expect(noTarget).not.toContain(' on ')
  })
  it('neutral_killed → camp cleared', () => {
    expect(line('neutral_killed', { playerId: 'me', neutralType: 'stub' })!.text).toContain(
      'cleared a stub camp',
    )
  })
  it('backup_used → reincarnation', () => {
    expect(line('backup_used', { playerId: 'me' })!.text).toContain('reincarnated via the Backup')
  })
  it('tenant_respawn → respawn line', () => {
    expect(line('tenant_respawn', {})!.text).toContain('Tenant has respawned')
  })
  it('tenant_killed with no killer team → generic fallen line', () => {
    expect(line('tenant_killed', {})!.text).toContain('Tenant has fallen')
  })
  it('talent_selected → learned line', () => {
    expect(line('talent_selected', { playerId: 'me', talentName: 'Sharp Edge' })!.text).toContain(
      'learned Sharp Edge',
    )
  })
  it('trap_triggered → trap caught line', () => {
    expect(
      line('trap_triggered', {
        owner: 'me',
        targetId: 'enemy1',
        zone: 'coldstore-cross',
        damage: 80,
      })!.text,
    ).toContain('trap caught')
  })
  it('teleport_cancelled → cancelled with reason', () => {
    expect(line('teleport_cancelled', { playerId: 'me', reason: 'took damage' })!.text).toContain(
      'cancelled (took damage)',
    )
  })
  it('harden_used → harden activated', () => {
    expect(line('harden_used', { team: 'chaff' })!.text).toContain('activated the Harden')
  })
  it('surrender_vote → vote tally', () => {
    expect(line('surrender_vote', { team: 'chaff', votesFor: 2, votesNeeded: 3 })!.text).toContain(
      'surrender vote: 2/3',
    )
  })
  it('surrendered → victory line', () => {
    expect(line('surrendered', { team: 'audit', winner: 'chaff' })!.text).toContain('surrendered')
  })
  it('an internal event (cooldown_used) produces no line', () => {
    expect(line('cooldown_used', { playerId: 'me', abilityId: 'q' })).toBeNull()
  })
})

describe('eventToLine: semantic hierarchy', () => {
  it('types a hero death as a headline, not as chip damage', () => {
    // A hero dying used to render `damage` — the same red, the same weight as a
    // wave taking 9 off a ice — and the OBJ filter dropped it entirely.
    const death = eventToLine(ev('death', { playerId: 'enemy1', respawnCycle: 20 }), ctx)!
    expect(death.type).toBe('kill')
  })

  it('types power-curve beats as objectives so OBJ can find them', () => {
    expect(eventToLine(ev('level_up', { playerId: 'me', newLevel: 7 }), ctx)!.type).toBe(
      'objective',
    )
    expect(
      eventToLine(ev('talent_selected', { playerId: 'me', talentName: '+250 INTEG' }), ctx)!.type,
    ).toBe('objective')
  })

  it('types a negated spell as a spell beat, not a grey notice', () => {
    expect(
      eventToLine(
        ev('spell_blocked', { source: 'intercept_shell', targetId: 'me', casterId: 'enemy1' }),
        ctx,
      )!.type,
    ).toBe('ability')
    expect(
      eventToLine(ev('teleport_cancelled', { playerId: 'me', reason: 'stunned' }), ctx)!.type,
    ).toBe('ability')
  })
})

describe('eventToLine: damage metadata for the cycle recap', () => {
  it('carries the amount and both labels on hero damage, not only structure chip', () => {
    const line = eventToLine(
      ev('damage', { sourceId: 'enemy1', targetId: 'me', amount: 84, damageType: 'kinetic' }),
      ctx,
    )!
    expect(line.dmgAmount).toBe(84)
    expect(line.sourceLabel).toBe('enemy1')
    expect(line.targetLabel).toBe('You')
    // Hero damage must still never collapse into a running line.
    expect(line.dedupKey).toBeUndefined()
  })

  it('does NOT carry a trap hit — the paired damage event already does', () => {
    // REGRESSION: the engine emits BOTH trap_triggered and a damage event for one
    // trap hit. Giving this line a dmgAmount made the per-cycle recap, which sums
    // dmgAmount across lines, report every trap at double its real damage.
    const line = eventToLine(
      ev('trap_triggered', {
        owner: 'enemy1',
        targetId: 'me',
        zone: 'coldstore-cross',
        damage: 100,
      }),
      ctx,
    )!
    expect(line.dmgAmount).toBeUndefined()
    // The narrative line itself still names the hit and its number.
    expect(line.text).toContain('100')
  })
})
