<script setup lang="ts">
interface ZoneDisplay {
  id: string
  name: string
  playerHere: boolean
  allies: string[]
  enemyCount: number
  tower?: { team: 'radiant' | 'dire'; alive: boolean; tier: number }
  fogged: boolean
}

defineProps<{
  zones: ZoneDisplay[]
  playerZone: string
}>()

function zoneLabel(zone: ZoneDisplay): string {
  if (zone.fogged) return '[???]'

  const parts: string[] = []

  if (zone.tower) {
    const mark = zone.tower.alive ? '\u2713' : '\u2717'
    parts.push(`[T${zone.tower.tier}${mark}]`)
  }

  if (zone.playerHere) {
    parts.push('[YOU*]')
  }

  for (const ally of zone.allies) {
    parts.push(`[${ally}]`)
  }

  if (zone.enemyCount > 0) {
    parts.push(`[${zone.enemyCount}E]`)
  }

  return parts.join(' ') || '[ ]'
}

function zoneClass(zone: ZoneDisplay): string {
  if (zone.fogged) return 'ascii-map__zone--fogged'
  if (zone.playerHere) return 'ascii-map__zone--current'
  if (zone.allies.length > 0) return 'ascii-map__zone--allied'
  if (zone.enemyCount > 0) return 'ascii-map__zone--enemy'
  return ''
}
</script>

<template>
  <div class="ascii-map-wrapper">
    <pre class="ascii-map"><template v-for="zone in zones" :key="zone.id"
><span
  class="ascii-map__zone"
  :class="zoneClass(zone)"
>{{ zone.name.padEnd(12) }} {{ zoneLabel(zone) }}
</span></template
></pre>
    <div v-if="!zones.length" class="ascii-map__empty">
      &gt;_ loading map data...
    </div>
  </div>
</template>

<style scoped>
.ascii-map-wrapper {
  height: 100%;
  overflow: auto;
}

.ascii-map {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  margin: 0;
  white-space: pre;
}

.ascii-map__zone {
  display: block;
  padding: 1px 4px;
  cursor: default;
}

.ascii-map__zone:hover {
  background: rgba(255, 255, 255, 0.03);
}

.ascii-map__zone--current {
  color: var(--color-self);
  font-weight: 700;
}

.ascii-map__zone--allied {
  color: var(--color-radiant);
}

.ascii-map__zone--enemy {
  color: var(--color-dire);
}

.ascii-map__zone--fogged {
  color: var(--text-dim);
  opacity: 0.5;
}

.ascii-map__empty {
  color: var(--text-dim);
  padding: 8px;
  font-size: 0.8rem;
}
</style>
