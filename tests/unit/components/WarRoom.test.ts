import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import WarRoom from '~~/app/components/game/WarRoom.vue'
import { useGameStore } from '~~/app/stores/game'
import { useSettingsStore } from '~~/app/stores/settings'
import { makeTickMessage, makeRoster, makePlayer, makeZone } from '~~/app/stories/fixtures'
import type { ZoneRuntimeState } from '~~/shared/types/game'

// WarRoom now reads useSettingsStore (the collapsible roster is a HUD
// setting that auto-persists); stub localStorage so no state leaks between
// tests through happy-dom's real storage.
const mockStorage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: vi.fn((k: string) => mockStorage.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => void mockStorage.set(k, v)),
  removeItem: vi.fn((k: string) => void mockStorage.delete(k)),
})

// WarRoom is a store-connected container; its leaf panels (ObjectiveTicker,
// EnemyThreatSheet, Sparkline) are pure and tested elsewhere. We stub them with
// probes that expose the props WarRoom wires in, so we assert the container's
// own derivations (net-worth lead, backup holder, day/night, vision) and that the
// store state is forwarded to the right child.
const ObjectiveTickerStub = {
  name: 'ObjectiveTicker',
  props: ['tenant', 'caches', 'backup', 'tick', 'backupHolder'],
  template: `<div data-testid="objective-ticker-stub" :data-backup-holder="backupHolder ? backupHolder.name : ''" :data-tick="tick" :data-cache-count="caches ? caches.length : 0" />`,
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
  store.playerId = 'p1' // p1 is chaff in makeRoster()
  store.updateFromTick(makeTickMessage(opts))
  return store
}

/** The ally roster is collapsed by default (simplified HUD); expand it for
 *  tests that assert the ally sheet. */
function expandRoster() {
  useSettingsStore().setHud('rosterExpanded', true)
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockStorage.clear()
})

describe('WarRoom', () => {
  it('renders the war-room shell with all four sections when the roster is expanded', () => {
    seedStore()
    expandRoster()
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
    expandRoster()
    const wrapper = mountWarRoom()
    const ally = wrapper.find('[data-testid="ally-status-stub"]')
    expect(ally.exists()).toBe(true)
    // makeRoster() seeds 5 chaff; p1 is the local player, so 4 allies remain.
    expect(ally.attributes('data-ally-count')).toBe('4')
  })

  describe('collapsible roster', () => {
    it('collapses only the ally roster to a slim [+] row by default (standard preset)', () => {
      seedStore()
      const wrapper = mountWarRoom()
      // The always-on readouts stay.
      const text = wrapper.text()
      expect(text).toContain('Net Worth')
      expect(text).toContain('Objectives')
      // The ally sheet is gone, replaced by the expand row.
      expect(wrapper.find('[data-testid="war-room-roster"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="ally-status-stub"]').exists()).toBe(false)
      const toggle = wrapper.find('[data-testid="war-room-roster-toggle"]')
      expect(toggle.exists()).toBe(true)
      expect(toggle.text()).toContain('[+]')
      expect(toggle.text()).toContain('Allies')
      expect(toggle.text()).not.toContain('Enemy Threat')
      expect(toggle.attributes('aria-expanded')).toBe('false')
    })

    it('keeps the enemy threat sheet on the default HUD, outside the roster toggle', () => {
      seedStore()
      const wrapper = mountWarRoom()
      expect(wrapper.find('[data-testid="war-room-roster"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Enemy Threat')
      const sheet = wrapper.find('[data-testid="enemy-threat-stub"]')
      expect(sheet.exists()).toBe(true)
      expect(Number(sheet.attributes('data-enemy-count'))).toBe(5)
      // It lives in its own always-rendered section, not inside the roster.
      expect(
        wrapper
          .find('[data-testid="war-room-enemy-threat"] [data-testid="enemy-threat-stub"]')
          .exists(),
      ).toBe(true)
    })

    it('leaves the enemy threat sheet up when the ally roster is collapsed again', async () => {
      seedStore()
      expandRoster()
      const wrapper = mountWarRoom()

      await wrapper.find('[data-testid="war-room-roster-toggle"]').trigger('click')

      expect(wrapper.find('[data-testid="ally-status-stub"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="enemy-threat-stub"]').exists()).toBe(true)
    })

    it('expands on click via the settings store (preset re-derives to custom)', async () => {
      seedStore()
      const settings = useSettingsStore()
      const wrapper = mountWarRoom()

      await wrapper.find('[data-testid="war-room-roster-toggle"]').trigger('click')

      // The toggle went through setHud → persists + preset becomes custom.
      expect(settings.hud.rosterExpanded).toBe(true)
      expect(settings.hudPreset).toBe('custom')
      expect(wrapper.find('[data-testid="war-room-roster"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="ally-status-stub"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="enemy-threat-stub"]').exists()).toBe(true)
      const toggle = wrapper.find('[data-testid="war-room-roster-toggle"]')
      expect(toggle.text()).toContain('[−]')
      expect(toggle.text()).toContain('Allies')
      expect(toggle.attributes('aria-expanded')).toBe('true')
    })

    it('collapses again from the expanded [−] affordance', async () => {
      seedStore()
      expandRoster()
      const settings = useSettingsStore()
      const wrapper = mountWarRoom()
      expect(wrapper.find('[data-testid="war-room-roster"]').exists()).toBe(true)

      await wrapper.find('[data-testid="war-room-roster-toggle"]').trigger('click')

      expect(settings.hud.rosterExpanded).toBe(false)
      expect(wrapper.find('[data-testid="war-room-roster"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="ally-status-stub"]').exists()).toBe(false)
    })

    it('renders expanded when the tactical preset (rosterExpanded) is active', () => {
      seedStore()
      useSettingsStore().applyHudPreset('tactical')
      const wrapper = mountWarRoom()
      expect(wrapper.find('[data-testid="war-room-roster"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="ally-status-stub"]').exists()).toBe(true)
    })
  })

  describe('net-worth lead', () => {
    it('shows the chaff lead when chaff is ahead on net worth', () => {
      // Hand chaff a huge gold pile so chaff net worth dominates.
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

    it('shows the audit lead when audit is ahead', () => {
      // Hand audit a huge gold pile so audit net worth dominates.
      const roster = makeRoster()
      for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) roster[id]!.gold = 50_000
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const p of Object.values(roster)) zones[p.zone] ??= makeZone(p.zone)
      seedStore({ players: roster, zones })
      const wrapper = mountWarRoom()
      expect(wrapper.text()).toContain('AUDIT +')
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
      expect(text).not.toContain('AUDIT +')
    })

    it('feeds the lead series (chaff-audit per tick) into the Sparkline', async () => {
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
      // chaff leading → colour var should be the chaff token
      expect(spark.attributes('data-color-var')).toBe('color-chaff')
    })
  })

  describe('objectives wiring', () => {
    it('forwards the current tick and cache list to the ObjectiveTicker', () => {
      seedStore() // makeGameState seeds tick 240 + one cache
      const wrapper = mountWarRoom()
      const ticker = wrapper.find('[data-testid="objective-ticker-stub"]')
      expect(ticker.attributes('data-tick')).toBe('240')
      expect(Number(ticker.attributes('data-cache-count'))).toBe(1)
    })

    it('resolves the backup holder from the player carrying the backup buff', () => {
      const roster = makeRoster()
      // Give p2 (Kernel) the backup buff — the engine models a carried backup as a buff.
      roster.p2 = makePlayer({
        ...roster.p2,
        buffs: [{ id: 'backup', stacks: 1, ticksRemaining: 30, source: 'tenant' }],
      })
      const zones: Record<string, ZoneRuntimeState> = {}
      for (const p of Object.values(roster)) zones[p.zone] ??= makeZone(p.zone)
      seedStore({ players: roster, zones })
      const wrapper = mountWarRoom()
      // backupHolder resolves heroId 'kernel' → 'Kernel'
      expect(
        wrapper.find('[data-testid="objective-ticker-stub"]').attributes('data-backup-holder'),
      ).toBe('Kernel')
    })

    it('passes no backup holder when nobody carries the buff', () => {
      seedStore()
      const wrapper = mountWarRoom()
      expect(
        wrapper.find('[data-testid="objective-ticker-stub"]').attributes('data-backup-holder'),
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
      // A chaff ward (the local player is chaff) in a visible zone, expiry
      // well past the seeded tick (240).
      const firstZone = Object.keys(zones)[0]!
      zones[firstZone] = makeZone(firstZone, {
        wards: [{ team: 'chaff', placedTick: 0, expiryTick: 9999, type: 'observer' }],
      })
      seedStore({ players: roster, zones })
      const text = mountWarRoom().text()
      expect(text).toContain('wards 1')
      expect(text).not.toContain('no wards')
    })
  })

  describe('enemy threat wiring', () => {
    it('forwards the full enemy roster (5 audit players) to the EnemyThreatSheet', () => {
      seedStore()
      const wrapper = mountWarRoom()
      const sheet = wrapper.find('[data-testid="enemy-threat-stub"]')
      expect(Number(sheet.attributes('data-enemy-count'))).toBe(5)
      expect(sheet.attributes('data-tick')).toBe('240')
    })
  })
})
