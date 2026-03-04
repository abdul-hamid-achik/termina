<script setup lang="ts">
import { computed } from 'vue'
import { ZONE_MAP } from '~~/shared/constants/zones'

interface ZoneDisplay {
  id: string
  name: string
  playerHere: boolean
  allies: string[]
  enemyCount: number
  tower?: { team: 'radiant' | 'dire'; alive: boolean; tier: number }
  fogged: boolean
  creepCount?: number
  creepTypes?: string[]
  neutralCount?: number
}

const props = defineProps<{
  zones: ZoneDisplay[]
  playerZone: string
}>()

const emit = defineEmits<{
  zoneClick: [zoneId: string]
}>()

// 5-column spatial grid: TOP LANE | RAD JUNGLE | MID LANE | DIRE JUNGLE | BOT LANE
// Rows go from Radiant base (top) to Dire base (bottom)
const MAP_ROWS: (string | null)[][] = [
  [null, 'radiant-fountain', null, 'radiant-base', null],
  ['top-t3-rad', null, 'mid-t3-rad', null, 'bot-t3-rad'],
  ['top-t2-rad', 'jungle-rad-top', 'mid-t2-rad', 'jungle-rad-bot', 'bot-t2-rad'],
  ['top-t1-rad', null, 'mid-t1-rad', null, 'bot-t1-rad'],
  ['top-river', 'rune-top', 'roshan-pit', 'rune-bot', 'bot-river'],
  [null, null, 'mid-river', null, null],
  ['top-t1-dire', null, 'mid-t1-dire', null, 'bot-t1-dire'],
  ['top-t2-dire', 'jungle-dire-top', 'mid-t2-dire', 'jungle-dire-bot', 'bot-t2-dire'],
  ['top-t3-dire', null, 'mid-t3-dire', null, 'bot-t3-dire'],
  [null, 'dire-base', null, 'dire-fountain', null],
]

const COL_HEADERS = ['TOP LANE', 'RADIANT JUNGLE', 'MID LANE', 'DIRE JUNGLE', 'BOT LANE']

const zoneMap = computed(() => {
  const map = new Map<string, ZoneDisplay>()
  for (const z of props.zones) {
    map.set(z.id, z)
  }
  return map
})

function getZone(id: string): ZoneDisplay | undefined {
  return zoneMap.value.get(id)
}

function cellText(zone: ZoneDisplay): string {
  // Zone name based on type
  let name = ''
  if (zone.id.includes('fountain') || zone.id.includes('base')) {
    name = zone.id.includes('radiant') ? '★ RAD' : '★ DIRE'
  } else if (zone.id.includes('t3')) {
    name = zone.id.includes('rad') ? '▲ RAD T3' : '▼ DIRE T3'
  } else if (zone.id.includes('t2')) {
    name = zone.id.includes('rad') ? '▲ RAD T2' : '▼ DIRE T2'
  } else if (zone.id.includes('t1')) {
    name = zone.id.includes('rad') ? '▲ RAD T1' : '▼ DIRE T1'
  } else if (zone.id.includes('river') || zone.id === 'mid-river') {
    name = '≈ RIVER ≈'
  } else if (zone.id.includes('roshan')) {
    name = '☠ ROSHAN'
  } else if (zone.id.includes('rune')) {
    name = '◆ RUNE'
  } else if (zone.id.includes('jungle')) {
    name = '☘ JUNGLE'
  } else {
    name = zone.id.slice(0, 8).toUpperCase()
  }

  if (zone.fogged) return `${name} ?`

  // Build indicators
  const indicators: string[] = []
  
  // Tower status
  if (zone.tower) {
    indicators.push(zone.tower.alive ? '✓' : '✗')
  }
  
  // Player position
  if (zone.playerHere) {
    indicators.push('►YOU')
  }
  
  // Allies
  if (zone.allies.length > 0) {
    indicators.push(`+${zone.allies.length}A`)
  }
  
  // Enemies
  if (zone.enemyCount > 0) {
    indicators.push(`!${zone.enemyCount}E`)
  }
  
  // Creeps
  if (zone.creepCount && zone.creepCount > 0) {
    indicators.push(`c${zone.creepCount}`)
  }
  
  // Neutrals
  if (zone.neutralCount && zone.neutralCount > 0) {
    indicators.push(`☘ ${zone.neutralCount}`)
  }

  return indicators.length > 0 ? `${name} ${indicators.join(' ')}` : name
}

function cellClasses(zone: ZoneDisplay): string {
  if (zone.fogged) return 'text-text-dim opacity-40'
  if (zone.playerHere) return 'text-self font-bold bg-self/20 border-2 border-self'
  if (zone.enemyCount > 0) return 'text-dire font-bold'
  if (zone.allies.length > 0) return 'text-radiant'
  return 'text-text-dim'
}

function zoneClickable(zoneId: string): boolean {
  if (!props.playerZone) return false
  return isAdjacent(zoneId)
}


function isAdjacent(zoneId: string): boolean {
  const playerZ = props.playerZone
  if (!playerZ) return false
  const playerZoneData = ZONE_MAP[playerZ]
  if (!playerZoneData) return false
  return playerZoneData.adjacentTo.includes(zoneId) || playerZ === zoneId
}

function handleZoneClick(zoneId: string) {
  emit('zoneClick', zoneId)
}
</script>

<template>
  <div class="h-full w-full flex flex-col" data-testid="ascii-map">
    <!-- Header -->
    <div class="flex items-center justify-center gap-8 border-b-2 border-border pb-2">
      <span class="text-lg font-bold tracking-[0.3em] text-radiant">RADIANT</span>
      <span class="text-xs text-text-dim">[MAP]</span>
      <span class="text-lg font-bold tracking-[0.3em] text-dire">DIRE</span>
    </div>

    <!-- Column headers -->
    <div class="grid grid-cols-5 gap-1 py-1">
      <span
        v-for="hdr in COL_HEADERS"
        :key="hdr"
        class="text-center font-mono text-xs font-bold uppercase tracking-wider text-text-dim"
      >
        {{ hdr }}
      </span>
    </div>

    <!-- Map grid - big and prominent -->
    <div class="flex-1 overflow-auto p-2">
      <div
        v-for="(row, ri) in MAP_ROWS"
        :key="ri"
        class="grid grid-cols-5 gap-1"
        :class="{
          'mb-2 border-b-2 border-river/60': ri === 3 || ri === 5,
        }"
      >
        <template v-for="(zoneId, ci) in row" :key="ci">
          <div
            v-if="zoneId && getZone(zoneId)"
            class="relative flex min-h-[70px] cursor-pointer flex-col items-center justify-center px-1 py-2 text-center font-mono text-xs leading-tight transition-all hover:scale-105"
            :class="[
              cellClasses(getZone(zoneId)!),
              zoneClickable(zoneId) ? 'bg-radiant/10 border-2 border-dashed border-radiant/60' : 'border-2 border-border/50 bg-bg-secondary/50'
            ]"
            :title="zoneId + (zoneClickable(zoneId) ? ' (click to move)' : '')"
            @click="zoneClickable(zoneId) && handleZoneClick(zoneId)"
          >
            <span class="relative z-10">{{ cellText(getZone(zoneId)!) }}</span>
          </div>
          <div v-else class="flex min-h-[70px] items-center justify-center border border-dashed border-border/20 bg-bg-primary/30">
            <span class="text-text-dim opacity-30">·</span>
          </div>
        </template>
      </div>
    </div>

    <!-- Legend -->
    <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-border pt-2 text-xs">
      <span class="text-radiant">+NA = N Allies</span>
      <span class="text-dire">!NE = N Enemies</span>
      <span class="text-self">►YOU = You</span>
      <span class="text-text-dim">cN = N Creeps</span>
      <span class="text-text-dim">☘N = N Neutrals</span>
      <span class="text-text-dim">✓/✗ = Tower</span>
    </div>

    <div v-if="!zones.length" class="p-4 text-sm text-text-dim">
      &gt;_ loading map data...
    </div>
  </div>
</template>
