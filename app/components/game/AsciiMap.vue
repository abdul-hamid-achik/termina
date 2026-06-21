<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ZONE_MAP } from '~~/shared/constants/zones'
import {
  mapRowsFor,
  colHeadersFor,
  gridColsClass,
  riverDividerRows,
  compactRiverDividerRow,
  ancientForZone,
  buildAdjacentZones,
  cellText,
  compactIndicators,
  zoneAriaLabel,
  zoneShortCode,
  zoneTeam,
} from './asciiMapModel'
import type { AncientsDisplay, ZoneDisplay } from './asciiMapModel'
import MapLegend from './MapLegend.vue'

const props = defineProps<{
  zones: ZoneDisplay[]
  playerZone: string
  ancients?: AncientsDisplay | null
  /** Force a layout (used in tests); defaults to viewport-width detection. */
  forceMode?: 'full' | 'compact'
  /** Which map's grid to render (see shared/constants/maps). Default = full 5v5. */
  mapId?: string
}>()

// The grid layout + column headers for the active map.
const MAP_ROWS = computed(() => mapRowsFor(props.mapId))
const COL_HEADERS = computed(() => colHeadersFor(props.mapId))
// Column count + river-divider rows derived from the active layout so the
// one-lane (1 col) and two-lane (4 col) maps align under their headers and
// frame their river correctly, instead of assuming the 5v5 5-column grid.
const GRID_COLS = computed(() => gridColsClass(MAP_ROWS.value))
const RIVER_ROWS = computed(() => riverDividerRows(MAP_ROWS.value))
const COMPACT_RIVER_ROW = computed(() => compactRiverDividerRow(MAP_ROWS.value))

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

// ── Layout mode (full grid on desktop, zone-centered cards below 1024px) ──
const COMPACT_BREAKPOINT = 1024

const viewportWidth = ref(
  typeof window !== 'undefined' ? window.innerWidth : COMPACT_BREAKPOINT + 1,
)

function updateViewportWidth() {
  viewportWidth.value = window.innerWidth
}

onMounted(() => {
  updateViewportWidth()
  window.addEventListener('resize', updateViewportWidth)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateViewportWidth)
})

const isCompact = computed(() => {
  if (props.forceMode) return props.forceMode === 'compact'
  return viewportWidth.value < COMPACT_BREAKPOINT
})

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

function cellClasses(zone: ZoneDisplay): string[] {
  const classes: string[] = []
  if (zone.fogged) classes.push('opacity-40')
  if (zone.playerHere) classes.push('bg-self/20')
  if (zone.enemyCount > 0) classes.push('text-dire')
  return classes
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

// ── Compact (mobile) mode ─────────────────────────────────────────
const showOverview = ref(false)

const currentZoneCard = computed(() => zoneMap.value.get(props.playerZone) ?? null)

const adjacentCards = computed(() => buildAdjacentZones(props.playerZone, props.zones))

function moveAriaLabel(zone: ZoneDisplay): string {
  const detail = compactIndicators(zone, ancientForZone(zone.id, props.ancients))
    .map((i) => i.text)
    .join(', ')
  return `Move to ${zone.name}. ${detail}`
}

function miniCellText(zoneId: string): string {
  const zone = getZone(zoneId)
  const ancient = ancientForZone(zoneId, props.ancients)
  let text = zoneShortCode(zoneId)
  if (ancient && !ancient.alive) text += '☠'
  if (zone && zone.enemyCount > 0) text += '!'
  if (zone?.playerHere) text = `►${text}`
  return text
}

function miniCellClasses(zoneId: string): string[] {
  const zone = getZone(zoneId)
  const team = zoneTeam(zoneId)
  const classes: string[] = [
    team === 'radiant' ? 'text-radiant' : team === 'dire' ? 'text-dire' : 'text-text-dim',
  ]
  if (zone?.playerHere) {
    classes.push('bg-self/30', 'font-bold')
  } else {
    classes.push('bg-bg-primary/60')
  }
  if (zone?.fogged) classes.push('opacity-40')
  return classes
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

    <!-- Glyph key for new players (collapsed by default) -->
    <div class="flex justify-center border-b border-border/40 py-0.5">
      <MapLegend />
    </div>

    <!-- ── Full 5x10 grid (desktop ≥1024px) ─────────────────────── -->
    <template v-if="!isCompact">
      <div class="grid gap-1 py-1" :class="GRID_COLS">
        <span
          v-for="hdr in COL_HEADERS"
          :key="hdr"
          class="text-center font-mono text-xs font-bold uppercase tracking-wider text-text-dim"
        >
          {{ hdr }}
        </span>
      </div>

      <div class="flex-1 overflow-auto p-2">
        <div
          ref="gridRef"
          role="grid"
          tabindex="0"
          class="outline-none"
          @keydown="handleGridKeydown"
        >
          <div
            v-for="(row, ri) in MAP_ROWS"
            :key="ri"
            class="grid gap-1"
            :class="[GRID_COLS, { 'mb-2 border-b-2 border-river/60': RIVER_ROWS.has(ri) }]"
          >
            <template v-for="(zoneId, ci) in row" :key="ci">
              <div
                v-if="zoneId && getZone(zoneId)"
                role="gridcell"
                :tabindex="focusedZoneId === zoneId ? 0 : -1"
                :aria-label="zoneAriaLabel(getZone(zoneId)!, ancientForZone(zoneId, ancients))"
                class="relative flex min-h-[70px] flex-col items-center justify-center px-1 py-2 text-center font-mono text-xs leading-tight transition-all"
                :class="[
                  cellClasses(getZone(zoneId)!),
                  zoneClickable(zoneId)
                    ? 'bg-radiant/10 cursor-pointer border-2 border-dashed border-radiant/60 hover:scale-105'
                    : 'cursor-default border-2 border-border/50 bg-bg-secondary/50',
                ]"
                :title="
                  zoneId +
                  (zoneClickable(zoneId)
                    ? ' (click to move)'
                    : getZone(zoneId)!.fogged
                      ? ' (fogged — no vision)'
                      : ' (not adjacent)')
                "
                @click="zoneClickable(zoneId) && handleZoneClick(zoneId)"
                @focus="focusedZoneId = zoneId"
              >
                <span class="relative z-10">{{
                  cellText(getZone(zoneId)!, ancientForZone(zoneId, ancients))
                }}</span>
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
        <span class="text-text-dim">◈ = Core</span>
      </div>
    </template>

    <!-- ── Compact zone-centered mode (<1024px) ─────────────────── -->
    <div
      v-else
      class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
      data-testid="compact-map"
    >
      <!-- Current zone card -->
      <div
        v-if="currentZoneCard"
        data-testid="compact-current-zone"
        class="border-2 border-self/70 bg-self/10 px-3 py-2 font-mono"
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm font-bold text-text-primary">{{ currentZoneCard.name }}</span>
          <span class="shrink-0 text-[0.65rem] font-bold tracking-widest text-self">►YOU</span>
        </div>
        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span
            v-for="ind in compactIndicators(
              currentZoneCard,
              ancientForZone(currentZoneCard.id, ancients),
            )"
            :key="ind.text"
            :class="ind.cls"
          >
            {{ ind.text }}
          </span>
        </div>
      </div>

      <!-- Adjacent zones: one tap = move -->
      <div class="flex flex-col gap-1.5" data-testid="compact-adjacent-list">
        <button
          v-for="zone in adjacentCards"
          :key="zone.id"
          type="button"
          data-testid="compact-adjacent-zone"
          class="bg-radiant/10 min-h-[56px] w-full border-2 border-dashed border-radiant/60 px-3 py-2 text-left font-mono transition-all active:scale-[0.98] active:bg-radiant/20"
          :class="{ 'opacity-50': zone.fogged }"
          :aria-label="moveAriaLabel(zone)"
          @click="handleZoneClick(zone.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-bold text-text-primary">{{ zone.name }}</span>
            <span class="shrink-0 text-[0.65rem] font-bold tracking-wider text-radiant">
              TAP TO MOVE ▸
            </span>
          </div>
          <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span
              v-for="ind in compactIndicators(zone, ancientForZone(zone.id, ancients))"
              :key="ind.text"
              :class="ind.cls"
            >
              {{ ind.text }}
            </span>
          </div>
        </button>
      </div>

      <!-- Mini overview toggle -->
      <button
        type="button"
        data-testid="overview-toggle"
        class="min-h-[44px] w-full border border-border bg-bg-secondary/60 px-3 py-2 font-mono text-xs font-bold tracking-wider text-text-dim transition-all hover:text-text-primary active:bg-border"
        :aria-expanded="showOverview"
        @click="showOverview = !showOverview"
      >
        [{{ showOverview ? 'HIDE' : 'SHOW' }} MAP OVERVIEW]
      </button>

      <div
        v-if="showOverview"
        data-testid="mini-overview"
        class="border border-border bg-bg-secondary/40 p-1.5"
      >
        <div
          v-for="(row, ri) in MAP_ROWS"
          :key="ri"
          class="grid gap-px"
          :class="[GRID_COLS, { 'mb-1 border-b border-river/40 pb-1': ri === COMPACT_RIVER_ROW }]"
        >
          <template v-for="(zoneId, ci) in row" :key="ci">
            <div
              v-if="zoneId"
              class="flex h-7 items-center justify-center font-mono text-[0.6rem]"
              :class="miniCellClasses(zoneId)"
            >
              {{ miniCellText(zoneId) }}
            </div>
            <div v-else class="h-7 bg-bg-primary/30" />
          </template>
        </div>
        <div class="mt-1 flex flex-wrap justify-center gap-x-3 text-[0.6rem] text-text-dim">
          <span class="text-self">► you</span>
          <span class="text-dire">! enemies</span>
          <span>☠ core down</span>
          <span
            ><span class="text-radiant">rad</span>/<span class="text-dire">dire</span> ground</span
          >
        </div>
      </div>
    </div>

    <div v-if="!zones.length" class="p-4 text-sm text-text-dim">&gt;_ loading map data...</div>
  </div>
</template>
