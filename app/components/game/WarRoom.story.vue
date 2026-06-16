<script setup lang="ts">
import { reactive } from 'vue'
import type { PlayerState } from '~~/shared/types/game'
import { useGameStore } from '~/stores/game'
import WarRoom from './WarRoom.vue'

// Validates the Histoire Pinia plumbing (histoire.setup.ts installs Pinia, so
// useGameStore() resolves) AND serves as the WarRoom story. Store-coupled
// components seed state by assigning the store's returned refs directly; each
// Variant supplies its own `:setup-app` seed (the same pattern GameScreen uses).
function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Player',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 520,
    maxHp: 620,
    mp: 180,
    maxMp: 300,
    level: 9,
    xp: 0,
    gold: 1400,
    items: ['blades_of_attack', null, null, null, null, null],
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
    towerDamageDealt: 0,
    killStreak: 0,
    buybackCost: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

function base() {
  const store = useGameStore()
  store.playerId = 'p1'
  store.dayNightTick = 12
  store.allPlayers = {
    p1: player(),
    p2: player({ id: 'p2', name: 'Ally', heroId: 'kernel', zone: 'top-river' }),
    e1: player({ id: 'e1', name: 'Enemy', team: 'dire', heroId: 'daemon', zone: 'mid-river' }),
  }
  return store
}

// Mid game, Radiant pulling ahead on net worth, Roshan up.
function seedAhead() {
  const store = base()
  store.tick = 240
  store.timeOfDay = 'day'
  store.netWorthHistory = reactive({
    radiant: [3200, 3400, 3800, 4200, 4600, 5100],
    dire: [3100, 3300, 3500, 3700, 3900, 4150],
  })
  store.roshan = { alive: true, hp: 3500, maxHp: 5000, deathTick: null }
}

// Radiant losing the gold race, Roshan at full (uncontested by us).
function seedBehind() {
  const store = base()
  store.tick = 360
  store.timeOfDay = 'day'
  store.netWorthHistory = reactive({
    radiant: [3200, 3100, 2900, 2700, 2500, 2300],
    dire: [3100, 3500, 4100, 4900, 5600, 6400],
  })
  store.roshan = { alive: true, hp: 5000, maxHp: 5000, deathTick: null }
}

// Late game, night, big Radiant lead, Roshan already taken.
function seedLateGame() {
  const store = base()
  store.tick = 600
  store.timeOfDay = 'night'
  store.netWorthHistory = reactive({
    radiant: [5100, 5600, 6200, 6900, 7500, 8200],
    dire: [4150, 4400, 4700, 5000, 5300, 5600],
  })
  store.roshan = { alive: false, hp: 0, maxHp: 5000, deathTick: 560 }
}
</script>

<template>
  <Story title="Game/WarRoom">
    <Variant title="radiant ahead" :setup-app="seedAhead">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <WarRoom />
      </div>
    </Variant>

    <Variant title="radiant behind" :setup-app="seedBehind">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <WarRoom />
      </div>
    </Variant>

    <Variant title="late game · night · Roshan down" :setup-app="seedLateGame">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <WarRoom />
      </div>
    </Variant>
  </Story>
</template>
