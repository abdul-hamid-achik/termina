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
  type: 'damage' | 'healing' | 'kill' | 'gold' | 'system' | 'ability' | 'victory'
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
    it('should display tick number', () => {
      const events = [makeEvent({ tick: 42 })]
      const wrapper = mount(CombatLog, { props: { events } })

      expect(wrapper.text()).toContain('[T42]')
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
    it('resolves ancient ids to readable Core names', () => {
      expect(ancientLabel('ancient_radiant')).toBe('the Radiant Core')
      expect(ancientLabel('ancient_dire')).toBe('the Dire Core')
    })

    it('falls back to a generic Core label for unknown teams', () => {
      expect(ancientLabel('ancient_neutral')).toBe('the neutral Core')
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
