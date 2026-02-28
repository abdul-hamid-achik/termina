<script setup lang="ts">
defineProps<{
  tick: number
  gameTime: string
  gold: number
  kills: number
  deaths: number
  assists: number
  heroId?: string
  connected?: boolean
  reconnecting?: boolean
  latency?: number
}>()

function formatGold(n: number): string {
  return n.toLocaleString()
}
</script>

<template>
  <div
    class="flex items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border bg-bg-secondary px-3 py-1 text-[0.8rem]"
    data-testid="game-state-bar"
  >
    <HeroAvatar v-if="heroId" :hero-id="heroId" :size="24" />
    <span class="inline-flex gap-1">
      <span class="text-text-dim">Tick:</span>
      <span class="text-text-primary">{{ tick }}</span>
    </span>
    <span class="text-border">|</span>
    <span class="inline-flex gap-1">
      <span class="text-text-primary">{{ gameTime }}</span>
    </span>
    <span class="text-border">|</span>
    <span class="inline-flex gap-1">
      <span class="text-text-dim">Gold:</span>
      <span class="text-gold">{{ formatGold(gold) }}</span>
    </span>
    <span class="text-border">|</span>
    <span class="inline-flex gap-1">
      <span class="text-text-dim">KDA:</span>
      <span class="text-text-primary">
        <span class="text-radiant">{{ kills }}</span
        >/<span class="text-dire">{{ deaths }}</span
        >/<span class="text-text-dim">{{ assists }}</span>
      </span>
    </span>
    <span class="text-border">|</span>
    <span v-if="reconnecting" class="text-dire">[RECONNECTING...]</span>
    <span v-else-if="connected" class="text-radiant">[CONNECTED {{ latency }}ms]</span>
    <span v-else class="text-text-dim">[OFFLINE]</span>
  </div>
</template>
