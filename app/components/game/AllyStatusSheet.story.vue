<script setup lang="ts">
import type { PlayerState } from '~~/shared/types/game'
import { SAMPLE_HEROES, makePlayer } from '~/stories/fixtures'
import AllyStatusSheet from './AllyStatusSheet.vue'

// The friendly counterpart to the enemy threat sheet: who's alive, where, how
// healthy, and what transient effects they hold — coloured from the ally's own
// perspective (a buff is green, a debuff is red), the inverse of the enemy sheet.
// Chips use the readable labels from ~/utils/buffs (Magic Immune, Overclocked,
// Stunned, Injected); bookkeeping ids and permanent stat auras never render —
// this strip is TRANSIENT effects only.
const TICK = 300

const allies: PlayerState[] = [
  makePlayer({
    id: 'a1',
    name: 'cipher_mid',
    team: 'chaff',
    heroId: SAMPLE_HEROES.cipher,
    zone: 'mid-river',
    hp: 720,
    maxHp: 900,
    level: 12,
    cooldowns: { q: 0, w: 3, e: 0, r: 0 }, // ult ready → green ULT badge
    // Holding BKB + an Overclocked steroid — good for them (green): dive-ready.
    buffs: [
      { id: 'magic_immune', stacks: 1, ticksRemaining: 4, source: 'item', destination: 'a1' },
      {
        id: 'stack_overflow_buff',
        stacks: 1,
        ticksRemaining: 3,
        source: 'ability',
        destination: 'a1',
      },
      // Bookkeeping + permanent ramping markers — must NOT render here:
      { id: 'inCombat', stacks: 1, ticksRemaining: 2, source: 'system', destination: 'a1' },
      { id: 'resonance', stacks: 6, ticksRemaining: 999, source: 'ability', destination: 'a1' },
    ],
  }),
  makePlayer({
    id: 'a2',
    name: 'socket_sup',
    team: 'chaff',
    heroId: SAMPLE_HEROES.socket,
    zone: 'jungle-audit-bot',
    hp: 90,
    maxHp: 520,
    level: 9,
    cooldowns: { q: 0, w: 0, e: 0, r: 9 }, // ult on cooldown → no badge
    // Low HP, stunned and burning — bad for them (red): they need help NOW.
    buffs: [
      { id: 'stun', stacks: 1, ticksRemaining: 2, source: 'enemy', destination: 'a2' },
      { id: 'inject_dot', stacks: 45, ticksRemaining: 3, source: 'enemy', destination: 'a2' },
    ],
  }),
  makePlayer({
    id: 'a3',
    name: 'firewall_off',
    team: 'chaff',
    heroId: SAMPLE_HEROES.firewall,
    zone: 'chaff-base',
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
