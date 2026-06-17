import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import WarRoom from '../../../app/components/game/WarRoom.vue'
import { useGameStore } from '../../../app/stores/game'
import { makeTickMessage, makeRoster, makePlayer, makeZone } from '../../../app/stories/fixtures'
import type { ZoneRuntimeState } from '../../../shared/types/game'

// WarRoom is a store-connected container; its leaf panels (ObjectiveTicker,
// EnemyThreatSheet, Sparkline) are pure and tested elsewhere. We stub them with
// probes that expose the props WarRoom wires in, so we assert the container's
// own derivations (net-worth lead, aegis holder, day/night, vision) and that the
// store state is forwarded to the right child.
const ObjectiveTickerStub = {
  name: 'ObjectiveTicker',
  props: ['roshan', 'runes', 'aegis', 'tick', 'aegisHolder'],
  template: `<div data-testid="objective-ticker-stub" :data-aegis-holder="aegisHolder ? aegisHolder.name : ''" :data-tick="tick" :data-rune-count="runes ? runes.length : 0" />`,
}

const EnemyThreatSheetStub = {
  name: 'EnemyThreatSheet',
  props: ['enemies', 'lastSeen', 'tick'],
  template: `<div data-testid="enemy-threat-stub" :data-enemy-count="enemies ? enemies.length : 0" :data-tick="tick" />`,
}

const AllyStatusSheetStub = {
  name: 'AllyStatusSheet',
  props: ['allies', 'tick'],
  template: `<div data-testid="ally-status-stub" :data-ally-count="allies ? allies.length : 0" :data-tick="tick" />`,
}

const SparklineStub = {
  name: 'Sparkline',
  props: ['values', 'colorVar'],
  template: `<div data-testid="sparkline-stub" :data-count="values ? values.length : 0" :data-color-var="colorVar" />`,
}

function mountWarRoom() {
  return mount(WarRoom, {
    global: {
      stubs: {
        ObjectiveTicker: ObjectiveTickerStub,
        EnemyThreatSheet: EnemyThreatSheetStub,
        AllyStatusSheet: AllyStatusSheetStub,
        Sparkline: SparklineStub,
      },
    },
  })
}

/** Seed the store as the WarRoom story does: pick a player id, feed ticks. */
function seedStore(opts: Parameters<typeof makeTickMessage>[0] = {}) {
  const store = useGameStore()
  store.playerId = 'p1' // p1 is radiant in makeRoster()
  store.updateFromTick(makeTickMessage(opts))
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('WarRoom', () => {
  it('renders the war-room shell with all four sections', () => {
    seedStore()
    const wrapper = mountWarRoom()
    expect(wrapper.find('[data-testid="war-room"]').exists()).toBe(true)
    const text = wrapper.text()
    expect(text).toContain('Net Worth')
    expect(text).toContain('Objectives')
    expect(text).toContain('Allies')
    expect(text).toContain('Enemy Threat')
  })

  it('forwards the ally roster (excluding self) to the ally status sheet', () => {
    seedStore()
    const wrapper = mountWarRoom()
    const ally = wrapper.find('[data-testid="ally-status-stub"]')
    expect(ally.exists()).toBe(true)
    // makeRoster() seeds 5 radiant; p1 is the local player, so 4 allies remain.
    expect(ally.attributes('data-ally-count')).toBe('4')
  })

  describe('net-worth lead', () => {
    it('shows the radiant lead when radiant is ahead on net worth', () => {
      // Hand radiant a huge gold pile so radiant net worth dominates.
      const roster = makeRoster()
      for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) roster[id]!.gold = 50_000
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const p of Object.values(roster)) zones[p.zone] ??= makeZone(p.zone)
      seedStore({ players: roster, zones })
      const wrapper = mountWarRoom()
      const text = wrapper.text()
      expect(text).toContain('RAD +')
      expect(text).not.toContain('even')
    })

    it('shows the dire lead when dire is ahead', () => {
      // Hand dire a huge gold pile so dire net worth dominates.
      const roster = makeRoster()
      for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) roster[id]!.gold = 50_000
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const p of Object.values(roster)) zones[p.zone] ??= makeZone(p.zone)
      seedStore({ players: roster, zones })
      const wrapper = mountWarRoom()
      expect(wrapper.text()).toContain('DIRE +')
    })

    it('shows "even" with no leader colour when net worth is tied', () => {
      // Equal gold + no items on both teams → a dead tie (goldLead leader null).
      const roster = makeRoster()
      for (const p of Object.values(roster)) {
        p.gold = 1000
        p.items = [null, null, null, null, null, null]
      }
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const p of Object.values(roster)) zones[p.zone] ??= makeZone(p.zone)
      seedStore({ players: roster, zones })
      const text = mountWarRoom().text()
      expect(text).toContain('even')
      expect(text).not.toContain('RAD +')
      expect(text).not.toContain('DIRE +')
    })

    it('feeds the lead series (radiant-dire per tick) into the Sparkline', async () => {
      const roster = makeRoster()
      for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) roster[id]!.gold = 50_000
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const p of Object.values(roster)) zones[p.zone] ??= makeZone(p.zone)
      const store = seedStore({ players: roster, zones })
      // a second tick → two samples in the history
      store.updateFromTick(makeTickMessage({ players: roster, zones }))
      await nextTick()
      const spark = mountWarRoom().find('[data-testid="sparkline-stub"]')
      expect(Number(spark.attributes('data-count'))).toBeGreaterThanOrEqual(2)
      // radiant leading → colour var should be the radiant token
      expect(spark.attributes('data-color-var')).toBe('color-radiant')
    })
  })

  describe('objectives wiring', () => {
    it('forwards the current tick and rune list to the ObjectiveTicker', () => {
      seedStore() // makeGameState seeds tick 240 + one rune
      const wrapper = mountWarRoom()
      const ticker = wrapper.find('[data-testid="objective-ticker-stub"]')
      expect(ticker.attributes('data-tick')).toBe('240')
      expect(Number(ticker.attributes('data-rune-count'))).toBe(1)
    })

    it('resolves the aegis holder from the player carrying the aegis buff', () => {
      const roster = makeRoster()
      // Give p2 (Kernel) the aegis buff — the engine models a carried aegis as a buff.
      roster.p2 = makePlayer({
        ...roster.p2,
        buffs: [{ id: 'aegis', stacks: 1, ticksRemaining: 30, source: 'roshan' }],
      })
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const p of Object.values(roster)) zones[p.zone] ??= makeZone(p.zone)
      seedStore({ players: roster, zones })
      const wrapper = mountWarRoom()
      // aegisHolder resolves heroId 'kernel' → 'Kernel'
      expect(
        wrapper.find('[data-testid="objective-ticker-stub"]').attributes('data-aegis-holder'),
      ).toBe('Kernel')
    })

    it('passes no aegis holder when nobody carries the buff', () => {
      seedStore()
      const wrapper = mountWarRoom()
      expect(
        wrapper.find('[data-testid="objective-ticker-stub"]').attributes('data-aegis-holder'),
      ).toBe('')
    })
  })

  describe('day/night + vision', () => {
    it('shows DAY with full-vision meaning by default', () => {
      seedStore({ timeOfDay: 'day' })
      const wrapper = mountWarRoom()
      const text = wrapper.text()
      expect(text).toContain('DAY')
      expect(text).toContain('full vision')
    })

    it('shows NIGHT with reduced-vision meaning at night', () => {
      seedStore({ timeOfDay: 'night' })
      const wrapper = mountWarRoom()
      const text = wrapper.text()
      expect(text).toContain('NIGHT')
      expect(text).toContain('vision reduced')
    })

    it('reports a vision count out of the total zones and "no wards" when unwarded', () => {
      seedStore() // makeGameState zones have no wards
      const wrapper = mountWarRoom()
      const text = wrapper.text()
      // visionSummary uses ZONES.length (32) as the denominator
      expect(text).toMatch(/vision \d+\/32/)
      expect(text).toContain('no wards')
    })

    it('reports active wards (and not "no wards") when the team has vision out', () => {
      const roster = makeRoster()
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const p of Object.values(roster)) zones[p.zone] ??= makeZone(p.zone)
      // A radiant ward (the local player is radiant) in a visible zone, expiry
      // well past the seeded tick (240).
      const firstZone = Object.keys(zones)[0]!
      zones[firstZone] = makeZone(firstZone, {
        wards: [{ team: 'radiant', placedTick: 0, expiryTick: 9999, type: 'observer' }],
      })
      seedStore({ players: roster, zones })
      const text = mountWarRoom().text()
      expect(text).toContain('wards 1')
      expect(text).not.toContain('no wards')
    })
  })

  describe('enemy threat wiring', () => {
    it('forwards the full enemy roster (5 dire players) to the EnemyThreatSheet', () => {
      seedStore()
      const wrapper = mountWarRoom()
      const sheet = wrapper.find('[data-testid="enemy-threat-stub"]')
      expect(Number(sheet.attributes('data-enemy-count'))).toBe(5)
      expect(sheet.attributes('data-tick')).toBe('240')
    })
  })
})
