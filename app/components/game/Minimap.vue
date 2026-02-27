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
  if (zone.fogged) return 'text-text-dim opacity-50'
  if (zone.hasPlayer) return 'text-self font-bold'
  if (zone.hasAllies) return 'text-radiant'
  if (zone.hasEnemies) return 'text-dire'
  return ''
}
</script>

<template>
  <div class="flex flex-col gap-0.5 text-xs">
    <div
      v-for="zone in zones"
      :key="zone.id"
      class="flex items-center gap-1.5 px-1 py-px"
      :class="{ 'bg-self/10': zone.id === playerZone }"
    >
      <span class="w-6 shrink-0 text-center" :class="indicatorClass(zone)"
        >[{{ indicator(zone) }}]</span
      >
      <span class="text-text-dim" :class="{ '!text-self': zone.id === playerZone }">{{
        zone.name
      }}</span>
    </div>
    <div v-if="!zones.length" class="p-1 text-text-dim">&gt;_ no zone data</div>
  </div>
</template>
