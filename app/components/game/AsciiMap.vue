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

function zoneClasses(zone: ZoneDisplay): string {
  if (zone.fogged) return 'text-text-dim opacity-50'
  if (zone.playerHere) return 'text-self font-bold'
  if (zone.allies.length > 0) return 'text-radiant'
  if (zone.enemyCount > 0) return 'text-dire'
  return ''
}
</script>

<template>
  <div class="h-full overflow-auto">
    <pre
      class="m-0 whitespace-pre font-mono text-xs leading-relaxed"
    ><template v-for="zone in zones" :key="zone.id"
><span
  class="block cursor-default px-1 py-px hover:bg-white/[0.03]"
  :class="zoneClasses(zone)"
>{{ zone.name.padEnd(12) }} {{ zoneLabel(zone) }}
</span></template
></pre>
    <div v-if="!zones.length" class="p-2 text-[0.8rem] text-text-dim">
      &gt;_ loading map data...
    </div>
  </div>
</template>
