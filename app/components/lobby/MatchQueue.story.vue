<script setup lang="ts">
import MatchQueue from './MatchQueue.vue'

// Props-driven (no store). MatchQueue animates roster slots "typing in" over time
// (a deep watch on `roster`) and, when `botsFilling` flips true, types in AI
// opponents one by one. The variants below are static snapshots of the queue at
// different fill levels; the typing/cursor animation runs live in each.
const PARTIAL_ROSTER = [
  { username: 'you', mmrBracket: 'Gold' },
  { username: 'kernel_main', mmrBracket: 'Plat' },
  { username: 'proxy_jg', mmrBracket: 'Gold' },
]

const NEARLY_FULL_ROSTER = [
  { username: 'you', mmrBracket: 'Gold' },
  { username: 'kernel_main', mmrBracket: 'Plat' },
  { username: 'proxy_jg', mmrBracket: 'Gold' },
  { username: 'support_sock', mmrBracket: 'Silver' },
  { username: 'cipher_off', mmrBracket: 'Plat' },
  { username: 'daemon_carry', mmrBracket: 'Diamond' },
  { username: 'regex_mid', mmrBracket: 'Gold' },
  { username: 'cache_sup', mmrBracket: 'Silver' },
]
</script>

<template>
  <Story title="Lobby/MatchQueue">
    <!-- Just searching: one player in the queue, empty slots blinking. -->
    <Variant title="searching (1 player)">
      <div class="flex justify-center bg-bg-primary p-4">
        <MatchQueue
          :roster="[{ username: 'you', mmrBracket: 'Gold' }]"
          :estimated-wait-seconds="90"
        />
      </div>
    </Variant>

    <!-- Filling up: a few real players found. -->
    <Variant title="partially filled">
      <div class="flex justify-center bg-bg-primary p-4">
        <MatchQueue :roster="PARTIAL_ROSTER" :estimated-wait-seconds="45" />
      </div>
    </Variant>

    <!-- Almost there: 8/10 real players, short wait estimate. -->
    <Variant title="nearly full">
      <div class="flex justify-center bg-bg-primary p-4">
        <MatchQueue :roster="NEARLY_FULL_ROSTER" :estimated-wait-seconds="10" />
      </div>
    </Variant>

    <!-- Backfilling with bots: the gold "filling with AI opponents" banner shows
         and bot slots type in over the empty slots. -->
    <Variant title="filling with bots">
      <div class="flex justify-center bg-bg-primary p-4">
        <MatchQueue
          :roster="PARTIAL_ROSTER"
          :estimated-wait-seconds="5"
          bots-filling
          :bots-count="7"
        />
      </div>
    </Variant>
  </Story>
</template>
