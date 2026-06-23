import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CombatLog from '../../../app/components/game/CombatLog.vue'
import {
  ancientLabel,
  isStructureTarget,
  teamLabel,
  collapseStructureDamage,
  type CombatLine,
} from '../../../app/utils/combatLog'

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
    it('should have text prefix for event type', () => {
      const events = [
        makeEvent({ type: 'damage', text: 'Player1 dealt 50 damage' }),
        makeEvent({ type: 'healing', text: 'Player1 healed for 30' }),
        makeEvent({ type: 'kill', text: 'Player1 killed Player2' }),
        makeEvent({ type: 'gold', text: 'Player1 earned 100g' }),
      ]
      const wrapper = mount(CombatLog, { props: { events } })

      const eventElements = wrapper.findAll('[data-testid="log-event"]')
      expect(eventElements[0]?.text()).toContain('[DAMAGE]')
      expect(eventElements[1]?.text()).toContain('[HEAL]')
      expect(eventElements[2]?.text()).toContain('[KILL]')
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

      expect(wrapper.text()).toContain('TICK 42')
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
      expect(text.match(/TICK 10/g)).toHaveLength(1)
      expect(text.match(/TICK 11/g)).toHaveLength(1)
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

  it('terse density hides bystander chip but keeps kills + objectives', async () => {
    const wrapper = mount(CombatLog, { props: { events } })
    await wrapper.get('[data-testid="log-density-toggle"]').trigger('click') // verbose -> terse
    expect(wrapper.text()).not.toContain('bystander chip')
    expect(wrapper.text()).toContain('a kill happened')
    expect(wrapper.text()).toContain('night falls')
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

  it('terse density also hides bystander gold spam', async () => {
    const wrapper = mount(CombatLog, {
      props: {
        events: [
          { tick: 1, text: 'someone banked gold', type: 'gold', salience: 'world' },
          { tick: 1, text: 'a kill happened', type: 'kill', salience: 'world' },
        ],
      },
    })
    await wrapper.get('[data-testid="log-density-toggle"]').trigger('click')
    expect(wrapper.text()).not.toContain('someone banked gold') // world gold hidden in terse
    expect(wrapper.text()).toContain('a kill happened')
  })
})
