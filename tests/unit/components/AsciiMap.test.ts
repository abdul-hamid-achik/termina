import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AsciiMap from '../../../app/components/game/AsciiMap.vue'
import type { ZoneDisplay } from '../../../app/components/game/AsciiMap.vue'

function makeZone(overrides: Partial<ZoneDisplay> = {}): ZoneDisplay {
  return {
    id: 'mid-t1-rad',
    name: 'Radiant Mid T1',
    playerHere: false,
    allies: [],
    enemyCount: 0,
    fogged: false,
    ...overrides,
  }
}

describe('AsciiMap', () => {
  describe('accessibility', () => {
    it('should have role="grid" on map container', () => {
      const zones = [makeZone()]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const grid = wrapper.find('[role="grid"]')
      expect(grid.exists()).toBe(true)
    })

    it('should have role="gridcell" on each zone cell', () => {
      const zones = [makeZone({ id: 'mid-t1-rad' }), makeZone({ id: 'top-t1-rad' })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cells = wrapper.findAll('[role="gridcell"]')
      expect(cells.length).toBeGreaterThanOrEqual(2)
    })

    it('should have aria-label on each zone cell', () => {
      const zones = [
        makeZone({ id: 'mid-t1-rad', name: 'Radiant Mid T1', allies: ['echo'], enemyCount: 1 }),
      ]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.attributes('aria-label')).toContain('Radiant Mid T1')
    })

    it('should describe zone content in aria-label', () => {
      const zones = [
        makeZone({
          id: 'mid-t1-rad',
          name: 'Radiant Mid T1',
          allies: ['echo', 'sentry'],
          enemyCount: 2,
          playerHere: true,
        }),
      ]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      const label = cell.attributes('aria-label')
      expect(label).toContain('2 allies')
      expect(label).toContain('2 enemies')
      expect(label).toContain('you')
    })

    it('should be keyboard navigable with arrow keys', async () => {
      const zones = [makeZone({ id: 'radiant-fountain' }), makeZone({ id: 'mid-t1-rad' })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'radiant-fountain' },
      })

      expect(wrapper.vm.focusedZoneId).toBe(null)

      const grid = wrapper.find('[role="grid"]')
      await grid.trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.vm.focusedZoneId).toBe('radiant-fountain')

      await grid.trigger('keydown', { key: 'ArrowRight' })
      expect(wrapper.vm.focusedZoneId).toBe('mid-t1-rad')
    })

    it('should announce zone updates to screen readers', async () => {
      const zones = [makeZone({ id: 'mid-t1-rad', enemyCount: 0 })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      await wrapper.setProps({
        zones: [makeZone({ id: 'mid-t1-rad', enemyCount: 2 })],
      })

      const liveRegion = wrapper.find('[aria-live="polite"]')
      expect(liveRegion.exists()).toBe(true)
    })
  })

  describe('zone display', () => {
    it('should show fogged zones with reduced opacity', () => {
      const zones = [makeZone({ fogged: true })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.classes()).toContain('opacity-40')
    })

    it('should highlight player zone', () => {
      const zones = [makeZone({ id: 'mid-t1-rad', playerHere: true })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.classes()).toContain('bg-self/20')
    })

    it('should highlight zones with enemies', () => {
      const zones = [makeZone({ enemyCount: 2 })]
      const wrapper = mount(AsciiMap, {
        props: { zones, playerZone: 'mid-t1-rad' },
      })

      const cell = wrapper.find('[role="gridcell"]')
      expect(cell.classes()).toContain('text-dire')
    })
  })
})
