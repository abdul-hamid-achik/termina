import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import ActionRow from '~~/app/components/game/ActionRow.vue'
import type { ZoneDisplay } from '~~/app/components/game/traceModel'
import { computeSituationalActions, stripTargetString } from '~~/app/utils/situationalActions'
import type { PlayerState, WaveUnitState } from '~~/shared/types/game'

function makeZone(id: string, name = id): ZoneDisplay {
  return {
    id,
    name,
    playerHere: false,
    allies: [],
    enemyCount: 0,
    fogged: false,
  }
}

function makePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'You',
    team: 'chaff',
    heroId: 'echo',
    zone: 'coldstore-t1-chaff',
    integ: 500,
    maxInteg: 500,
    bw: 200,
    maxBw: 200,
    level: 1,
    xp: 0,
    scrip: 600,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnCycle: null,
    plate: 3,
    ice: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    buybackCost: 100,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...over,
  }
}

function wave(over: Partial<WaveUnitState> = {}): WaveUnitState {
  return {
    id: 'w0',
    team: 'audit',
    zone: 'coldstore-t1-chaff',
    integ: 100,
    maxInteg: 400,
    type: 'line',
    ...over,
  }
}

function mountRow(
  opts: {
    moveZones?: ZoneDisplay[]
    situational?: ReturnType<typeof computeSituationalActions>
    abilities?: Record<string, { label: string; ready: boolean } | undefined>
  } = {},
) {
  return mount(ActionRow, {
    props: {
      moveZones: opts.moveZones ?? [],
      situational: opts.situational ?? [],
      abilities: opts.abilities ?? {},
      abilityArias: {},
      shopOpen: false,
      scoreboardOpen: false,
      canBuy: true,
    },
  })
}

describe('ActionRow', () => {
  it('renders the static strip and emits plain commands for the buttons', async () => {
    const wrapper = mountRow()
    for (const cmd of ['ATK', 'MOVE', 'SHOP', 'SCORE']) {
      expect(wrapper.find(`[data-testid="action-${cmd.toLowerCase()}"]`).exists()).toBe(true)
    }
    await wrapper.find('[data-testid="action-atk"]').trigger('click')
    expect(wrapper.emitted('command')).toEqual([['ATK']])
  })

  it('STRIP emits attack wave:<index> for the lowest-INTEG HOSTILE unit', () => {
    const player = makePlayer()
    const waves = [
      wave({ id: 'w-ally-low', team: 'chaff', integ: 30 }),
      wave({ id: 'w-enemy-high', team: 'audit', integ: 300 }),
      wave({ id: 'w-enemy-low', team: 'audit', integ: 60 }),
    ]
    // The lowest hostile is w-enemy-low at index 2.
    expect(stripTargetString(player, waves)).toBe('wave:2')

    const actions = computeSituationalActions({
      player,
      isAlive: true,
      waves,
      backup: null,
      caches: [],
      teams: null,
      cycle: 100,
    })
    const strip = actions.find((a) => a.label === 'STRIP')
    expect(strip?.cmd).toBe('attack wave:2')
  })

  it('BURN appears only when a friendly unit is at/below the threshold', () => {
    const player = makePlayer()
    const healthy = computeSituationalActions({
      player,
      isAlive: true,
      waves: [wave({ team: 'chaff', integ: 400, maxInteg: 400 })],
      backup: null,
      caches: [],
      teams: null,
      cycle: 100,
    })
    expect(healthy.some((a) => a.label === 'BURN')).toBe(false)

    const burnable = computeSituationalActions({
      player,
      isAlive: true,
      waves: [wave({ team: 'chaff', integ: 100, maxInteg: 400 })],
      backup: null,
      caches: [],
      teams: null,
      cycle: 100,
    })
    const burn = burnable.find((a) => a.label === 'BURN')
    expect(burn?.cmd).toBe('burn')
  })

  it('renders the move picker and emits move <zoneId> for an adjacent zone', async () => {
    const wrapper = mountRow({
      moveZones: [
        makeZone('coldstore-cross', 'Coldstore Crossing'),
        makeZone('cache-seawall', 'Seawall Cache Drop'),
      ],
    })

    expect(wrapper.find('[data-testid="move-picker"]').exists()).toBe(false)
    await wrapper.find('[data-testid="action-move"]').trigger('click')
    expect(wrapper.find('[data-testid="move-picker"]').exists()).toBe(true)

    await wrapper.find('[data-testid="move-picker-coldstore-cross"]').trigger('click')
    expect(wrapper.emitted('command')).toContainEqual(['move coldstore-cross'])
    expect(wrapper.find('[data-testid="move-picker"]').exists()).toBe(false)
  })

  it('emits the situational command string (STRIP) on tap', async () => {
    const wrapper = mountRow({
      situational: [
        { cmd: 'attack wave:2', label: 'STRIP', aria: 'Attack the lowest-INTEG hostile wave' },
      ],
    })
    await wrapper.find('[data-testid="situational-attack wave:2"]').trigger('click')
    expect(wrapper.emitted('command')).toEqual([['attack wave:2']])
  })

  it('disables ability buttons that are not ready', () => {
    const wrapper = mountRow({
      abilities: { Q: { label: 'Q·3', ready: false } },
    })
    const q = wrapper.find('[data-testid="action-q"]')
    expect(q.attributes('aria-disabled')).toBe('true')
    expect(q.attributes('disabled')).toBeDefined()
  })

  /**
   * R3-09 — prompt-primary on desktop. The strip is a touch affordance; pure
   * CSS hides it under (pointer: fine). happy-dom does not apply media-query
   * styles, so the contract is asserted on the component source: the strip is
   * always in the DOM (coarse / default) and the fine-pointer rule kills it.
   */
  it('keeps the button strip in the DOM by default (coarse / no media match)', () => {
    const wrapper = mountRow()
    expect(wrapper.find('[data-testid="action-row"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-atk"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('hides the strip under fine pointer via the R3-09 media query', () => {
    const src = readFileSync(resolve(process.cwd(), 'app/components/game/ActionRow.vue'), 'utf8')
    expect(src).toMatch(
      /@media\s*\(\s*pointer:\s*fine\s*\)[\s\S]*?\.action-row\s*\{[\s\S]*?display:\s*none/,
    )
  })
})
