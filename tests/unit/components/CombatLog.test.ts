import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CombatLog from '~~/app/components/game/CombatLog.vue'
import {
  ancientLabel,
  isStructureTarget,
  teamLabel,
  collapseStructureDamage,
  digestTeamfightNoise,
  type CombatLine,
} from '~~/app/utils/combatLog'

interface LogEvent {
  tick: number
  text: string
  type: 'damage' | 'healing' | 'kill' | 'gold' | 'system' | 'ability' | 'victory' | 'objective'
  salience?: 'mine-in' | 'mine-out' | 'ally' | 'world'
  killerHeroId?: string
  victimHeroId?: string
}

function makeEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    tick: 1,
    text: 'Test event',
    type: 'system',
    ...overrides,
  }
}

describe('CombatLog', () => {
  describe('accessibility', () => {
    it('should have text prefix for event type (story mode leads with the kill)', () => {
      const events = [
        makeEvent({ type: 'damage', text: 'Player1 dealt 50 damage' }),
        makeEvent({ type: 'healing', text: 'Player1 healed for 30' }),
        makeEvent({ type: 'kill', text: 'Player1 killed Player2' }),
        makeEvent({ type: 'gold', text: 'Player1 earned 100g' }),
      ]
      const wrapper = mount(CombatLog, { props: { events } })

      // Default story view orders a tick's lines by salience: the kill leads,
      // the rest keep their original relative order.
      const eventElements = wrapper.findAll('[data-testid="log-event"]')
      expect(eventElements[0]?.text()).toContain('[KILL]')
      expect(eventElements[1]?.text()).toContain('[DAMAGE]')
      expect(eventElements[2]?.text()).toContain('[HEAL]')
      expect(eventElements[3]?.text()).toContain('[GOLD]')
    })

    it('should be readable by screen readers', () => {
      const events = [makeEvent({ type: 'kill', text: 'Player1 killed Player2' })]
      const wrapper = mount(CombatLog, { props: { events } })

      const event = wrapper.find('[data-testid="log-event"]')
      expect(event.attributes('aria-label')).toBeDefined()
    })

    it('should have aria-live region for new events', () => {
      const events = [makeEvent()]
      const wrapper = mount(CombatLog, { props: { events } })

      const liveRegion = wrapper.find('[aria-live="polite"]')
      expect(liveRegion.exists()).toBe(true)
    })
  })

  describe('event display', () => {
    it('should display the tick as a beat header', () => {
      const events = [makeEvent({ tick: 42 })]
      const wrapper = mount(CombatLog, { props: { events } })

      expect(wrapper.text()).toContain('CYCLE 42')
    })

    it('groups consecutive same-tick events under one beat header', () => {
      const events = [
        makeEvent({ tick: 10, type: 'damage', text: 'a' }),
        makeEvent({ tick: 10, type: 'damage', text: 'b' }),
        makeEvent({ tick: 11, type: 'kill', text: 'c' }),
      ]
      const wrapper = mount(CombatLog, { props: { events } })
      const text = wrapper.text()
      // one header per distinct tick
      expect(text.match(/CYCLE 10/g)).toHaveLength(1)
      expect(text.match(/CYCLE 11/g)).toHaveLength(1)
      // all three event lines still render
      expect(wrapper.findAll('[data-testid="log-event"]')).toHaveLength(3)
    })

    it('marks incoming-to-me damage with a YOU salience marker', () => {
      const events = [makeEvent({ type: 'damage', text: 'hit', salience: 'mine-in' })]
      const wrapper = mount(CombatLog, { props: { events } })
      expect(wrapper.text()).toContain('YOU')
    })

    it('should color events by type', () => {
      const events = [makeEvent({ type: 'damage' }), makeEvent({ type: 'healing' })]
      const wrapper = mount(CombatLog, { props: { events } })

      const damageEvent = wrapper.find('.border-l-damage')
      const healEvent = wrapper.find('.border-l-healing')

      expect(damageEvent.exists()).toBe(true)
      expect(healEvent.exists()).toBe(true)
    })

    it('should show empty state when no events', () => {
      const wrapper = mount(CombatLog, { props: { events: [] } })

      expect(wrapper.text()).toContain('awaiting events')
    })
  })
})

describe('combatLog helpers', () => {
  describe('ancientLabel', () => {
    it('resolves ancient ids to readable Mainframe names', () => {
      expect(ancientLabel('ancient_radiant')).toBe('the Radiant Mainframe')
      expect(ancientLabel('ancient_dire')).toBe('the Dire Mainframe')
    })

    it('falls back to a generic Mainframe label for unknown teams', () => {
      expect(ancientLabel('ancient_neutral')).toBe('the neutral Mainframe')
    })

    it('returns null for non-ancient ids', () => {
      expect(ancientLabel('tower_mid-t1-rad')).toBeNull()
      expect(ancientLabel('github_7379966')).toBeNull()
      expect(ancientLabel('creep_3')).toBeNull()
    })
  })

  describe('isStructureTarget', () => {
    it('flags towers and ancients', () => {
      expect(isStructureTarget('tower_mid-t3-dire')).toBe(true)
      expect(isStructureTarget('ancient_radiant')).toBe(true)
    })

    it('does not flag heroes, creeps, or non-strings', () => {
      expect(isStructureTarget('github_1')).toBe(false)
      expect(isStructureTarget('creep_3')).toBe(false)
      expect(isStructureTarget(undefined)).toBe(false)
      expect(isStructureTarget(42)).toBe(false)
    })
  })

  describe('teamLabel', () => {
    it('title-cases team ids', () => {
      expect(teamLabel('radiant')).toBe('Radiant')
      expect(teamLabel('dire')).toBe('Dire')
    })
  })

  describe('collapseStructureDamage', () => {
    const fmt = ({ baseText, count, total }: { baseText: string; count: number; total: number }) =>
      `${baseText} (${count} hits, ${total} total)`

    function dmgLine(tick: number, source: string, target: string, amount: number): CombatLine {
      return {
        tick,
        text: `${source} dealt ${amount} physical damage to ${target}`,
        type: 'damage',
        dedupKey: `dmg:${source}->${target}`,
        dmgAmount: amount,
      }
    }

    it('collapses consecutive identical structure-damage lines into one running line', () => {
      const lines: CombatLine[] = [
        dmgLine(176, 'Thread', 'the Dire Core', 72),
        dmgLine(177, 'Thread', 'the Dire Core', 72),
        dmgLine(178, 'Thread', 'the Dire Core', 70),
      ]

      const result = collapseStructureDamage(lines, fmt)
      expect(result).toHaveLength(1)
      expect(result[0]!.count).toBe(3)
      expect(result[0]!.tick).toBe(178) // keeps the latest tick
      expect(result[0]!.text).toContain('(3 hits, 214 total)')
    })

    it('keeps a different source as its own line', () => {
      const lines: CombatLine[] = [
        dmgLine(176, 'Thread', 'the Dire Core', 72),
        dmgLine(177, 'Thread', 'the Dire Core', 72),
        dmgLine(178, 'Echo', 'the Dire Core', 50),
      ]

      const result = collapseStructureDamage(lines, fmt)
      expect(result).toHaveLength(2)
      expect(result[0]!.count).toBe(2)
      expect(result[1]!.text).toContain('Echo dealt 50')
      expect(result[1]!.count).toBe(1)
    })

    it('does not merge across an interrupting non-structure line', () => {
      const kill: CombatLine = { tick: 177, text: '[KILL] Thread eliminated Echo!', type: 'kill' }
      const lines: CombatLine[] = [
        dmgLine(176, 'Thread', 'the Dire Core', 72),
        kill,
        dmgLine(178, 'Thread', 'the Dire Core', 72),
      ]

      const result = collapseStructureDamage(lines, fmt)
      expect(result).toHaveLength(3)
      expect(result[1]!.type).toBe('kill')
    })

    it('passes through hero-vs-hero damage (no dedupKey) untouched', () => {
      const lines: CombatLine[] = [
        { tick: 1, text: 'Thread dealt 50 damage to Echo', type: 'damage' },
        { tick: 2, text: 'Thread dealt 50 damage to Echo', type: 'damage' },
      ]

      const result = collapseStructureDamage(lines, fmt)
      expect(result).toHaveLength(2)
      expect(result[0]!.count).toBeUndefined()
      expect(result[1]!.text).not.toContain('hits')
    })

    it('strips internal bookkeeping fields from the output', () => {
      const result = collapseStructureDamage([dmgLine(1, 'Thread', 'the Dire Core', 10)], fmt)
      expect(result[0]).not.toHaveProperty('total')
      expect(result[0]).not.toHaveProperty('baseText')
    })
  })

  describe('digestTeamfightNoise', () => {
    const worldDmg = (tick: number, amount: number): CombatLine => ({
      tick,
      text: 'some hero hits another',
      type: 'damage',
      salience: 'world',
      dmgAmount: amount,
    })

    it('folds a run of bystander damage into one summary past the threshold', () => {
      const lines = [
        worldDmg(5, 40),
        worldDmg(5, 50),
        worldDmg(5, 30),
        worldDmg(5, 60),
        worldDmg(5, 20),
      ]
      const result = digestTeamfightNoise(lines)
      expect(result).toHaveLength(1)
      expect(result[0]!.text).toContain('teamfight')
      expect(result[0]!.text).toContain('5 hits')
      expect(result[0]!.text).toContain('200 dmg')
    })

    it('leaves a small skirmish (at/below threshold) as individual lines', () => {
      const lines = [worldDmg(5, 40), worldDmg(5, 50), worldDmg(5, 30)]
      const result = digestTeamfightNoise(lines)
      expect(result).toHaveLength(3)
    })

    it('never folds lines that involve me, an ally, kills, or structures', () => {
      const mine: CombatLine = {
        tick: 5,
        text: 'I take damage',
        type: 'damage',
        salience: 'mine-in',
        dmgAmount: 99,
      }
      const kill: CombatLine = { tick: 5, text: 'a kill', type: 'kill', salience: 'world' }
      const struct: CombatLine = {
        tick: 5,
        text: 'tower hit',
        type: 'damage',
        salience: 'world',
        dedupKey: 'dmg:x->tower',
        dmgAmount: 10,
      }
      const result = digestTeamfightNoise([mine, kill, struct])
      expect(result).toHaveLength(3)
      expect(result).toContainEqual(expect.objectContaining({ salience: 'mine-in' }))
    })
  })
})

describe('CombatLog victory line', () => {
  it('renders a single [VICTORY] tag for victory-type events (no doubled [KILL])', () => {
    const events = [
      { tick: 200, text: 'Radiant destroyed the Dire Core!', type: 'victory' as const },
    ]
    const wrapper = mount(CombatLog, { props: { events } })

    const el = wrapper.find('[data-testid="log-event"]')
    const text = el.text()
    expect(text).toContain('[VICTORY]')
    expect(text).toContain('Radiant destroyed the Dire Core!')
    // Exactly one bracket tag — no leftover [KILL] doubling, no "tower in base".
    expect(text).not.toContain('[KILL]')
    expect(text).not.toContain('tower')
  })
})

describe('CombatLog filters + density', () => {
  const events: LogEvent[] = [
    { tick: 1, text: 'sys chat line', type: 'system' }, // salience-less → always shown
    { tick: 1, text: 'I hit them', type: 'damage', salience: 'mine-out' },
    { tick: 1, text: 'bystander chip', type: 'damage', salience: 'world' },
    { tick: 1, text: 'a kill happened', type: 'kill', salience: 'world' },
    { tick: 1, text: 'night falls', type: 'objective', salience: 'world' },
  ]

  it('always keeps salience-less system/chat lines under non-ALL filters', async () => {
    const wrapper = mount(CombatLog, { props: { events } })
    await wrapper.get('[data-testid="log-filter-combat"]').trigger('click')
    expect(wrapper.text()).toContain('sys chat line') // system never filtered away
    expect(wrapper.text()).toContain('I hit them') // combat kept
    expect(wrapper.text()).not.toContain('night falls') // objective filtered out under COMBAT
  })

  it('ME filter shows only my events (plus system)', async () => {
    const wrapper = mount(CombatLog, { props: { events } })
    await wrapper.get('[data-testid="log-filter-me"]').trigger('click')
    expect(wrapper.text()).toContain('I hit them')
    expect(wrapper.text()).not.toContain('bystander chip')
  })

  it('story mode (default) folds farm-tagged lines into one digest per tick', () => {
    const wrapper = mount(CombatLog, {
      props: {
        events: [
          {
            tick: 1,
            text: 'Kernel hit a creep for 60',
            type: 'damage',
            salience: 'ally',
            farmKind: 'hit',
          },
          {
            tick: 1,
            text: 'Ping hit a creep for 55',
            type: 'damage',
            salience: 'ally',
            farmKind: 'hit',
          },
          {
            tick: 1,
            text: 'Kernel last-hit a melee creep (+40g)',
            type: 'gold',
            salience: 'ally',
            farmKind: 'lasthit',
          },
          {
            tick: 1,
            text: 'You last-hit a melee creep (+38g)',
            type: 'gold',
            salience: 'mine-out',
            farmKind: 'lasthit',
            goldAmount: 38,
          },
          { tick: 1, text: 'a kill happened', type: 'kill', salience: 'world' },
        ] as CombatLine[],
      },
    })
    // Raw farm lines are folded away…
    expect(wrapper.text()).not.toContain('Kernel hit a creep')
    expect(wrapper.text()).not.toContain('Ping hit a creep')
    // …into one dim summary carrying my gold + the team tally…
    expect(wrapper.text()).toContain('farm: you +38g (1 last-hit) · team 1 creep')
    // …while the kill stays loud.
    expect(wrapper.text()).toContain('a kill happened')
  })

  it('the verbose toggle restores the raw line-per-event stream', async () => {
    const wrapper = mount(CombatLog, {
      props: {
        events: [
          {
            tick: 1,
            text: 'Kernel hit a creep for 60',
            type: 'damage',
            salience: 'ally',
            farmKind: 'hit',
          },
          { tick: 1, text: 'a kill happened', type: 'kill', salience: 'world' },
        ] as CombatLine[],
      },
    })
    await wrapper.get('[data-testid="log-density-toggle"]').trigger('click') // story -> verbose
    expect(wrapper.text()).toContain('Kernel hit a creep for 60')
    expect(wrapper.text()).toContain('a kill happened')
    expect(wrapper.text()).not.toContain('farm:')
  })

  it('OBJ filter shows objectives and kills (plus system), hiding plain damage', async () => {
    const wrapper = mount(CombatLog, { props: { events } })
    await wrapper.get('[data-testid="log-filter-obj"]').trigger('click')
    expect(wrapper.text()).toContain('night falls') // objective kept
    expect(wrapper.text()).toContain('a kill happened') // kill kept
    expect(wrapper.text()).toContain('sys chat line') // system never filtered away
    expect(wrapper.text()).not.toContain('I hit them') // plain damage dropped
    expect(wrapper.text()).not.toContain('bystander chip')
  })

  it('shows the "no events match" notice when a filter excludes everything', async () => {
    // A lone world-salience damage line: dropped by ME, and no system line survives.
    const wrapper = mount(CombatLog, {
      props: { events: [{ tick: 1, text: 'far-away fight', type: 'damage', salience: 'world' }] },
    })
    await wrapper.get('[data-testid="log-filter-me"]').trigger('click')
    expect(wrapper.text()).toContain('no events match')
  })

  it('story mode keeps untagged lines (hero fights, gold) — only farm noise folds', () => {
    const wrapper = mount(CombatLog, {
      props: {
        events: [
          { tick: 1, text: 'someone banked gold', type: 'gold', salience: 'world' },
          { tick: 1, text: 'a kill happened', type: 'kill', salience: 'world' },
        ] as CombatLine[],
      },
    })
    expect(wrapper.text()).toContain('someone banked gold')
    expect(wrapper.text()).toContain('a kill happened')
  })
})

describe('CombatLog per-tick recap', () => {
  const fight: CombatLine[] = [
    {
      tick: 12,
      text: 'Mutex hit You for 84',
      type: 'damage',
      salience: 'mine-in',
      dmgAmount: 84,
      sourceLabel: 'Mutex',
      targetLabel: 'You',
    },
    {
      tick: 12,
      text: 'burn hit You for 25',
      type: 'damage',
      salience: 'mine-in',
      dmgAmount: 25,
      sourceLabel: 'burn',
      targetLabel: 'You',
    },
    {
      tick: 12,
      text: 'You hit Thread for 62',
      type: 'damage',
      salience: 'mine-out',
      dmgAmount: 62,
      sourceLabel: 'You',
      targetLabel: 'Thread',
    },
  ]

  it('sums the tick for the player, on by default', () => {
    const wrapper = mount(CombatLog, { props: { events: fight } })
    const recap = wrapper.find('[data-testid="tick-recap"]')
    expect(recap.exists()).toBe(true)
    expect(recap.text()).toContain('You took 109 (Mutex 84, burn 25)')
    expect(recap.text()).toContain('You dealt 62 to Thread')
  })

  it('is dismissable from the toggle beside the density button', async () => {
    const wrapper = mount(CombatLog, { props: { events: fight } })
    await wrapper.get('[data-testid="log-recap-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="tick-recap"]').exists()).toBe(false)
    await wrapper.get('[data-testid="log-recap-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="tick-recap"]').exists()).toBe(true)
  })

  it('reports the whole tick even when a filter hides the lines it summed', async () => {
    const events: CombatLine[] = [
      ...fight,
      { tick: 12, text: 'Mutex terminated Kernel', type: 'kill', salience: 'ally' },
    ]
    const wrapper = mount(CombatLog, { props: { events } })
    await wrapper.get('[data-testid="log-filter-obj"]').trigger('click')
    // OBJ drops every damage line, but what the tick did to you is not a
    // function of which chip you are currently looking at.
    expect(wrapper.text()).not.toContain('Mutex hit You for 84')
    expect(wrapper.find('[data-testid="tick-recap"]').text()).toContain('You took 109')
  })

  it('says nothing for a tick that did not touch the player', () => {
    const wrapper = mount(CombatLog, {
      props: {
        events: [
          {
            tick: 3,
            text: 'Kernel hit Thread for 90',
            type: 'damage',
            salience: 'ally',
            dmgAmount: 90,
          },
        ] as CombatLine[],
      },
    })
    expect(wrapper.find('[data-testid="tick-recap"]').exists()).toBe(false)
  })
})

describe('CombatLog semantic hierarchy', () => {
  /** Weight classes on the line row (the tag span is always bold). */
  function lineClasses(event: CombatLine): string[] {
    const wrapper = mount(CombatLog, { props: { events: [event] } })
    return wrapper.find('[data-testid="log-event"]').classes()
  }

  it('ranks a headline above a notable event above ordinary chip', () => {
    // Nine line types used to render at two weights, so a hero death, a
    // level-up and a creep's chip damage all read at the same emphasis.
    expect(lineClasses({ tick: 1, text: 'a death', type: 'kill' })).toContain('font-bold')
    const objective = lineClasses({ tick: 1, text: 'reached level 7', type: 'objective' })
    expect(objective).toContain('font-semibold')
    expect(objective).not.toContain('font-bold')
    const chip = lineClasses({ tick: 1, text: 'chip', type: 'damage' })
    expect(chip).not.toContain('font-bold')
    expect(chip).not.toContain('font-semibold')
  })

  it('glows the headline text itself, and only the headline', () => {
    const html = (event: CombatLine) =>
      mount(CombatLog, { props: { events: [event] } })
        .find('[data-testid="log-event"] span:last-child')
        .classes()
    expect(html({ tick: 1, text: 'the Core fell', type: 'victory' })).toContain('text-glow-sm')
    expect(html({ tick: 1, text: 'reached level 7', type: 'objective' })).not.toContain(
      'text-glow-sm',
    )
  })
})
