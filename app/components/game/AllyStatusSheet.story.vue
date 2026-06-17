<script setup lang="ts">
import type { PlayerState } from '~~/shared/types/game'
import { SAMPLE_HEROES, makePlayer } from '~/stories/fixtures'
import AllyStatusSheet from './AllyStatusSheet.vue'

// The friendly counterpart to the enemy threat sheet: who's alive, where, how
// healthy, and what transient effects they hold — coloured from the ally's own
// perspective (a buff is green, a debuff is red), the inverse of the enemy sheet.
const TICK = 300

const allies: PlayerState[] = [
  makePlayer({
    id: 'a1',
    name: 'cipher_mid',
    team: 'radiant',
    heroId: SAMPLE_HEROES.cipher,
    zone: 'mid-river',
    hp: 720,
    maxHp: 900,
    level: 12,
    // Holding BKB — good for them (green): safe to dive with.
    buffs: [
      { id: 'magic_immune', stacks: 1, ticksRemaining: 4, source: 'item', destination: 'a1' },
    ],
  }),
  makePlayer({
    id: 'a2',
    name: 'socket_sup',
    team: 'radiant',
    heroId: SAMPLE_HEROES.socket,
    zone: 'dire-jungle',
    hp: 90,
    maxHp: 520,
    level: 9,
    // Low HP and stunned — bad for them (red): they need help NOW.
    buffs: [{ id: 'stun', stacks: 1, ticksRemaining: 2, source: 'enemy', destination: 'a2' }],
  }),
  makePlayer({
    id: 'a3',
    name: 'firewall_off',
    team: 'radiant',
    heroId: SAMPLE_HEROES.firewall,
    zone: 'radiant-base',
    level: 10,
    alive: false,
    hp: 0,
    respawnTick: TICK + 22,
  }),
]
</script>

<template>
  <Story title="Game/AllyStatusSheet" :layout="{ type: 'grid', width: 280 }">
    <Variant title="mixed (healthy · in danger · dead)">
      <div class="bg-bg-primary p-2" style="width: 240px">
        <AllyStatusSheet :allies="allies" :tick="TICK" />
      </div>
    </Variant>

    <Variant title="solo (no allies)">
      <div class="bg-bg-primary p-2" style="width: 240px">
        <AllyStatusSheet :allies="[]" :tick="TICK" />
      </div>
    </Variant>
  </Story>
</template>
