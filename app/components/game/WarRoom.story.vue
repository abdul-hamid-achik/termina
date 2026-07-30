<script setup lang="ts">
import { reactive } from 'vue'
import type { PlayerState } from '~~/shared/types/game'
import { useGameStore } from '~/stores/game'
import { useSettingsStore } from '~/stores/settings'
import WarRoom from './WarRoom.vue'

// Validates the Histoire Pinia plumbing (histoire.setup.ts installs Pinia, so
// useGameStore() resolves) AND serves as the WarRoom story. Store-coupled
// components seed state by assigning the store's returned refs directly; each
// Variant supplies its own `:setup-app` seed (the same pattern GameScreen uses).
function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player',
    team: 'chaff',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 520,
    maxHp: 620,
    mp: 180,
    maxMp: 300,
    level: 9,
    xp: 0,
    gold: 1400,
    items: ['edge_kit', null, null, null, null, null],
    cooldowns: { q: 0, w: 2, e: 0, r: 8 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 15,
    kills: 4,
    deaths: 1,
    assists: 6,
    damageDealt: 0,
    iceDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function base(rosterExpanded = true) {
  // The roster toggle is a persisted HUD setting and Histoire variants share
  // the preview's localStorage — seed it EXPLICITLY per variant so one
  // variant's toggle can't leak into another.
  useSettingsStore().setHud('rosterExpanded', rosterExpanded)
  const store = useGameStore()
  store.playerId = 'p1'
  store.dayNightTick = 12
  store.allPlayers = {
    p1: player(),
    p2: player({ id: 'p2', name: 'Ally', heroId: 'kernel', zone: 'top-river' }),
    e1: player({ id: 'e1', name: 'Enemy', team: 'audit', heroId: 'daemon', zone: 'mid-river' }),
  }
  return store
}

// Mid game, Chaff pulling ahead on net worth, Tenant up.
function seedAhead() {
  const store = base()
  store.tick = 240
  store.timeOfDay = 'day'
  store.netWorthHistory = reactive({
    chaff: [3200, 3400, 3800, 4200, 4600, 5100],
    audit: [3100, 3300, 3500, 3700, 3900, 4150],
  })
  store.tenant = { alive: true, hp: 3500, maxHp: 5000, deathTick: null }
}

// Chaff losing the gold race, Tenant at full (uncontested by us).
function seedBehind() {
  const store = base()
  store.tick = 360
  store.timeOfDay = 'day'
  store.netWorthHistory = reactive({
    chaff: [3200, 3100, 2900, 2700, 2500, 2300],
    audit: [3100, 3500, 4100, 4900, 5600, 6400],
  })
  store.tenant = { alive: true, hp: 5000, maxHp: 5000, deathTick: null }
}

// Late game, night, big Chaff lead, Tenant already taken.
function seedLateGame() {
  const store = base()
  store.tick = 600
  store.timeOfDay = 'night'
  store.netWorthHistory = reactive({
    chaff: [5100, 5600, 6200, 6900, 7500, 8200],
    audit: [4150, 4400, 4700, 5000, 5300, 5600],
  })
  store.tenant = { alive: false, hp: 0, maxHp: 5000, deathTick: 560 }
}

// The simplified default: roster collapsed to the slim [+] row (readouts stay).
function seedCollapsed() {
  const store = base(false)
  store.tick = 240
  store.timeOfDay = 'day'
  store.netWorthHistory = reactive({
    chaff: [3200, 3400, 3800, 4200, 4600, 5100],
    audit: [3100, 3300, 3500, 3700, 3900, 4150],
  })
  store.tenant = { alive: true, hp: 3500, maxHp: 5000, deathTick: null }
}
</script>

<template>
  <Story title="Game/WarRoom">
    <Variant title="chaff ahead" :setup-app="seedAhead">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <WarRoom />
      </div>
    </Variant>

    <Variant title="chaff behind" :setup-app="seedBehind">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <WarRoom />
      </div>
    </Variant>

    <Variant title="late game · night · Tenant down" :setup-app="seedLateGame">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <WarRoom />
      </div>
    </Variant>

    <Variant title="roster collapsed (default)" :setup-app="seedCollapsed">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <WarRoom />
      </div>
    </Variant>
  </Story>
</template>
