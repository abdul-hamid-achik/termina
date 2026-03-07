<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const gridRef = ref<HTMLElement>()
const focusedZoneId = ref<string | null>(null)
const announcement = ref('')

watch(
  () => props.zones,
  (newZones, oldZones) => {
    for (const newZone of newZones) {
      const oldZone = oldZones?.find((z) => z.id === newZone.id)
      if (oldZone && newZone.enemyCount > (oldZone?.enemyCount ?? 0)) {
        announcement.value = `${newZone.name}: ${newZone.enemyCount} enemies detected`
        return
      }
    }
  },
)

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

  const indicators: string[] = []

  if (zone.tower) {
    indicators.push(zone.tower.alive ? '✓' : '✗')
  }

  if (zone.playerHere) {
    indicators.push('►YOU')
  }

  if (zone.allies.length > 0) {
    indicators.push(`+${zone.allies.length}A`)
  }

  if (zone.enemyCount > 0) {
    indicators.push(`!${zone.enemyCount}E`)
  }

  if (zone.creepCount && zone.creepCount > 0) {
    indicators.push(`c${zone.creepCount}`)
  }

  if (zone.neutralCount && zone.neutralCount > 0) {
    indicators.push(`☘ ${zone.neutralCount}`)
  }

  return indicators.length > 0 ? `${name} ${indicators.join(' ')}` : name
}

function cellClasses(zone: ZoneDisplay): string[] {
  const classes: string[] = []
  if (zone.fogged) classes.push('opacity-40')
  if (zone.playerHere) classes.push('bg-self/20')
  if (zone.enemyCount > 0) classes.push('text-dire')
  return classes
}

function zoneAriaLabel(zone: ZoneDisplay): string {
  const parts: string[] = [zone.name]

  if (zone.playerHere) parts.push('you are here')
  if (zone.allies.length > 0) parts.push(`${zone.allies.length} allies`)
  if (zone.enemyCount > 0) parts.push(`${zone.enemyCount} enemies`)
  if (zone.fogged) parts.push('fogged')

  return parts.join(', ')
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

function handleGridKeydown(e: KeyboardEvent) {
  const allZones = props.zones.map((z) => z.id)
  const currentIdx = focusedZoneId.value ? allZones.indexOf(focusedZoneId.value) : -1

  if (e.key === 'ArrowRight') {
    e.preventDefault()
    const nextIdx = Math.min(currentIdx + 1, allZones.length - 1)
    focusedZoneId.value = allZones[nextIdx] ?? null
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    const nextIdx = Math.max(currentIdx - 1, 0)
    focusedZoneId.value = allZones[nextIdx] ?? null
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    const nextIdx = Math.min(currentIdx + 5, allZones.length - 1)
    focusedZoneId.value = allZones[nextIdx] ?? null
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const nextIdx = Math.max(currentIdx - 5, 0)
    focusedZoneId.value = allZones[nextIdx] ?? null
  } else if (e.key === 'Enter' && focusedZoneId.value) {
    if (zoneClickable(focusedZoneId.value)) {
      handleZoneClick(focusedZoneId.value)
    }
  }
}
</script>

<template>
  <div class="h-full w-full flex flex-col" data-testid="ascii-map">
    <div aria-live="polite" class="sr-only">{{ announcement }}</div>

    <div class="flex items-center justify-center gap-8 border-b-2 border-border pb-2">
      <span class="text-lg font-bold tracking-[0.3em] text-radiant">RADIANT</span>
      <span class="text-xs text-text-dim">[MAP]</span>
      <span class="text-lg font-bold tracking-[0.3em] text-dire">DIRE</span>
    </div>

    <div class="grid grid-cols-5 gap-1 py-1">
      <span
        v-for="hdr in COL_HEADERS"
        :key="hdr"
        class="text-center font-mono text-xs font-bold uppercase tracking-wider text-text-dim"
      >
        {{ hdr }}
      </span>
    </div>

    <div class="flex-1 overflow-auto p-2">
      <div ref="gridRef" role="grid" tabindex="0" class="outline-none" @keydown="handleGridKeydown">
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
              role="gridcell"
              :tabindex="focusedZoneId === zoneId ? 0 : -1"
              :aria-label="zoneAriaLabel(getZone(zoneId)!)"
              class="relative flex min-h-[70px] cursor-pointer flex-col items-center justify-center px-1 py-2 text-center font-mono text-xs leading-tight transition-all hover:scale-105"
              :class="[
                cellClasses(getZone(zoneId)!),
                zoneClickable(zoneId)
                  ? 'bg-radiant/10 border-2 border-dashed border-radiant/60'
                  : 'border-2 border-border/50 bg-bg-secondary/50',
              ]"
              :title="zoneId + (zoneClickable(zoneId) ? ' (click to move)' : '')"
              @click="zoneClickable(zoneId) && handleZoneClick(zoneId)"
              @focus="focusedZoneId = zoneId"
            >
              <span class="relative z-10">{{ cellText(getZone(zoneId)!) }}</span>
            </div>
            <div
              v-else
              class="flex min-h-[70px] items-center justify-center border border-dashed border-border/20 bg-bg-primary/30"
            >
              <span class="text-text-dim opacity-30">·</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div
      class="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-border pt-2 text-xs"
    >
      <span class="text-radiant">+NA = N Allies</span>
      <span class="text-dire">!NE = N Enemies</span>
      <span class="text-self">►YOU = You</span>
      <span class="text-text-dim">cN = N Creeps</span>
      <span class="text-text-dim">☘N = N Neutrals</span>
      <span class="text-text-dim">✓/✗ = Tower</span>
    </div>

    <div v-if="!zones.length" class="p-4 text-sm text-text-dim">&gt;_ loading map data...</div>
  </div>
</template>
