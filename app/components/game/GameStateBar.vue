<script setup lang="ts">
defineProps<{
  tick: number
  gameTime: string
  gold: number
  kills: number
  deaths: number
  assists: number
}>()

function formatGold(n: number): string {
  return n.toLocaleString()
}
</script>

<template>
  <div class="game-state-bar">
    <span class="gsb__item">
      <span class="gsb__label">Tick:</span>
      <span class="gsb__value">{{ tick }}</span>
    </span>
    <span class="gsb__sep">|</span>
    <span class="gsb__item">
      <span class="gsb__value">{{ gameTime }}</span>
    </span>
    <span class="gsb__sep">|</span>
    <span class="gsb__item">
      <span class="gsb__label">Gold:</span>
      <span class="gsb__value gsb__gold">{{ formatGold(gold) }}</span>
    </span>
    <span class="gsb__sep">|</span>
    <span class="gsb__item">
      <span class="gsb__label">KDA:</span>
      <span class="gsb__value">
        <span class="gsb__kills">{{ kills }}</span>/<span class="gsb__deaths">{{ deaths }}</span>/<span class="gsb__assists">{{ assists }}</span>
      </span>
    </span>
  </div>
</template>

<style scoped>
.game-state-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.8rem;
  white-space: nowrap;
  overflow-x: auto;
}

.gsb__item {
  display: inline-flex;
  gap: 4px;
}

.gsb__label {
  color: var(--text-dim);
}

.gsb__value {
  color: var(--text-primary);
}

.gsb__sep {
  color: var(--border-color);
}

.gsb__gold {
  color: var(--color-gold);
}

.gsb__kills {
  color: var(--color-radiant);
}

.gsb__deaths {
  color: var(--color-dire);
}

.gsb__assists {
  color: var(--text-dim);
}
</style>
