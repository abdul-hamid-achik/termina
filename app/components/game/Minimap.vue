<script setup lang="ts">
interface MinimapZone {
  id: string
  name: string
  hasPlayer: boolean
  hasAllies: boolean
  hasEnemies: boolean
  fogged: boolean
}

defineProps<{
  zones: MinimapZone[]
  playerZone: string
}>()

function indicator(zone: MinimapZone): string {
  if (zone.fogged) return '?'
  if (zone.hasPlayer) return '*'
  if (zone.hasAllies) return '+'
  if (zone.hasEnemies) return '!'
  return '-'
}

function indicatorClass(zone: MinimapZone): string {
  if (zone.fogged) return 'mm__ind--fogged'
  if (zone.hasPlayer) return 'mm__ind--self'
  if (zone.hasAllies) return 'mm__ind--ally'
  if (zone.hasEnemies) return 'mm__ind--enemy'
  return ''
}
</script>

<template>
  <div class="minimap">
    <div
      v-for="zone in zones"
      :key="zone.id"
      class="mm__zone"
      :class="{ 'mm__zone--current': zone.id === playerZone }"
    >
      <span class="mm__ind" :class="indicatorClass(zone)">[{{ indicator(zone) }}]</span>
      <span class="mm__name">{{ zone.name }}</span>
    </div>
    <div v-if="!zones.length" class="mm__empty">&gt;_ no zone data</div>
  </div>
</template>

<style scoped>
.minimap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.75rem;
}

.mm__zone {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 4px;
}

.mm__zone--current {
  background: rgba(52, 152, 219, 0.1);
}

.mm__ind {
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}

.mm__ind--self {
  color: var(--color-self);
  font-weight: 700;
}

.mm__ind--ally {
  color: var(--color-radiant);
}

.mm__ind--enemy {
  color: var(--color-dire);
}

.mm__ind--fogged {
  color: var(--text-dim);
  opacity: 0.5;
}

.mm__name {
  color: var(--text-dim);
}

.mm__zone--current .mm__name {
  color: var(--color-self);
}

.mm__empty {
  color: var(--text-dim);
  padding: 4px;
}
</style>
