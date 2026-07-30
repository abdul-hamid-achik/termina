<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ZONE_MAP } from '~~/shared/constants/zones'
import {
  mapRowsFor,
  colHeadersFor,
  shortColHeadersFor,
  gridColsClass,
  riverDividerRows,
  compactRiverDividerRow,
  ancientForZone,
  buildAdjacentZones,
  buildRouteMarkers,
  cellText,
  compactIndicators,
  miniOverviewCell,
  zoneAriaLabel,
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
  /** Start with the compact mini overview expanded (used by stories/tests). */
  overviewOpen?: boolean
  /** Destination of the hero's queued auto-path walk, if any — drawn as a route. */
  moveTarget?: string | null
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

// The walk drawn on the board. The display list IS the game's zone set (GameScreen
// builds it from zonesForMap), so it doubles as the BFS restriction — the route
// then matches the hops the server will actually take.
const routeMarkers = computed(() =>
  buildRouteMarkers(props.playerZone, props.moveTarget, (id) => zoneMap.value.has(id)),
)

function routeAria(zoneId: string): string {
  const marker = routeMarkers.value.get(zoneId)
  if (!marker) return ''
  return marker === '⌖' ? ', walk destination' : `, walk step ${marker}`
}

function cellClasses(zone: ZoneDisplay): string[] {
  const classes: string[] = []
  if (zone.fogged) classes.push('opacity-40')
  if (zone.playerHere) classes.push('bg-self/20')
  if (zone.enemyCount > 0) classes.push('text-audit')
  return classes
}

// Auto-path: every zone is a valid movement order (the hero walks one zone
// per tick toward it), so every cell except your own is clickable. Adjacent
// zones keep the brighter dashed styling — those arrive next tick.
function zoneClickable(zoneId: string): boolean {
  if (!props.playerZone) return false
  return zoneId !== props.playerZone
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
  // Navigate the actual 2D layout (MAP_ROWS) rather than a flat list with a
  // hardcoded 5-column step — that broke up/down on the one-lane (1 col) and
  // two-lane (4 col) maps. MAP_ROWS has null cells (visual gaps), so movement
  // skips over them to the next real zone in the pressed direction.
  const rows = MAP_ROWS.value
  if (!rows.length) return

  // Locate the focused cell in the grid (row, col).
  let r = -1
  let c = -1
  if (focusedZoneId.value) {
    for (let ri = 0; ri < rows.length; ri++) {
      const ci = rows[ri]!.indexOf(focusedZoneId.value)
      if (ci !== -1) {
        r = ri
        c = ci
        break
      }
    }
  }

  // First real zone scanning the whole grid — the entry point from no focus.
  function firstCell(): string | null {
    for (const row of rows) for (const id of row) if (id) return id
    return null
  }
  // Nearest real zone in a row to column `col` (search outward both ways).
  function nearestInRow(ri: number, col: number): string | null {
    const row = rows[ri]
    if (!row) return null
    if (row[col]) return row[col]!
    for (let d = 1; d < row.length; d++) {
      if (row[col - d]) return row[col - d]!
      if (row[col + d]) return row[col + d]!
    }
    return null
  }
  // Horizontal scan from c in `step` direction, skipping null gaps.
  function horiz(step: number): string | null {
    if (r < 0) return firstCell()
    const row = rows[r]!
    for (let nc = c + step; nc >= 0 && nc < row.length; nc += step) {
      if (row[nc]) return row[nc]!
    }
    return null
  }
  // Vertical: walk rows in `step` direction, landing on the nearest real zone.
  function vert(step: number): string | null {
    if (r < 0) return firstCell()
    for (let nr = r + step; nr >= 0 && nr < rows.length; nr += step) {
      const id = nearestInRow(nr, c)
      if (id) return id
    }
    return null
  }

  // GameScreen listens for bare arrows on `window` and turns them into a move
  // order, so every arrow consumed here must stop bubbling — browsing the grid
  // with the keyboard would otherwise also walk the hero one zone per press.
  let next: string | null = null
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault()
      e.stopPropagation()
      next = horiz(1)
      break
    case 'ArrowLeft':
      e.preventDefault()
      e.stopPropagation()
      next = horiz(-1)
      break
    case 'ArrowDown':
      e.preventDefault()
      e.stopPropagation()
      next = vert(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      e.stopPropagation()
      next = vert(-1)
      break
    case 'Enter':
      if (focusedZoneId.value && zoneClickable(focusedZoneId.value)) {
        handleZoneClick(focusedZoneId.value)
      }
      return
    default:
      return
  }
  if (next) {
    focusedZoneId.value = next
    // Move real DOM focus to the cell (now focusable via the roving tabindex)
    // so screen readers announce its aria-label — visual focus alone was silent.
    nextTick(() => {
      gridRef.value?.querySelector<HTMLElement>(`[data-zone-cell="${next}"]`)?.focus()
    })
  }
}

// ── Compact (mobile) mode ─────────────────────────────────────────
const showOverview = ref(props.overviewOpen ?? false)

const currentZoneCard = computed(() => zoneMap.value.get(props.playerZone) ?? null)

const adjacentCards = computed(() => buildAdjacentZones(props.playerZone, props.zones))

function moveAriaLabel(zone: ZoneDisplay): string {
  const detail = compactIndicators(zone, ancientForZone(zone.id, props.ancients))
    .map((i) => i.text)
    .join(', ')
  return `Move to ${zone.name}${routeAria(zone.id)}. ${detail}`
}

// Mini-overview: short column headers + per-cell display models, all derived
// from the active map layout via pure asciiMapModel helpers.
const MINI_COL_HEADERS = computed(() => shortColHeadersFor(props.mapId))

const miniRows = computed(() =>
  MAP_ROWS.value.map((row) =>
    row.map((zoneId) =>
      zoneId
        ? miniOverviewCell(zoneId, getZone(zoneId), ancientForZone(zoneId, props.ancients))
        : null,
    ),
  ),
)
</script>

<template>
  <div class="h-full w-full flex flex-col" data-testid="ascii-map">
    <div aria-live="polite" class="sr-only">{{ announcement }}</div>

    <div class="flex items-center justify-center gap-8 border-b-2 border-border pb-2">
      <span class="text-lg font-bold tracking-[0.3em] text-chaff">CHAFF</span>
      <span class="text-xs text-text-dim">[MAP]</span>
      <span class="text-lg font-bold tracking-[0.3em] text-audit">AUDIT</span>
    </div>

    <!-- Harden key for new players (collapsed by default) -->
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

      <!-- The banner above reads left-to-right, which says nothing about which
           END of the grid each team holds. Chaff is always the top row. -->
      <div class="text-center t-hud-xs font-bold tracking-widest text-chaff">CHAFF ▲</div>

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
                :data-zone-cell="zoneId"
                :tabindex="focusedZoneId === zoneId ? 0 : -1"
                :aria-label="
                  zoneAriaLabel(getZone(zoneId)!, ancientForZone(zoneId, ancients)) +
                  routeAria(zoneId)
                "
                class="map-cell relative flex min-h-[70px] flex-col items-center justify-center px-1 py-2 text-center font-mono text-xs leading-tight transition-all"
                :class="[
                  cellClasses(getZone(zoneId)!),
                  !zoneClickable(zoneId)
                    ? 'cursor-default border-2 border-border/50 bg-bg-secondary/50'
                    : isAdjacent(zoneId)
                      ? 'bg-chaff/10 cursor-pointer border-2 border-dashed border-chaff/60 hover:scale-105'
                      : 'cursor-pointer border-2 border-border/60 bg-bg-secondary/50 hover:border-chaff/50 hover:scale-105',
                ]"
                :title="
                  zoneId +
                  (!zoneClickable(zoneId)
                    ? ''
                    : isAdjacent(zoneId)
                      ? ' (click to move — next tick)'
                      : ' (click to travel — one zone per tick)')
                "
                @click="zoneClickable(zoneId) && handleZoneClick(zoneId)"
                @focus="focusedZoneId = zoneId"
              >
                <span
                  v-if="routeMarkers.get(zoneId)"
                  class="absolute top-0.5 right-0.5 z-10 font-mono t-hud-xs font-bold text-self"
                  :data-route-marker="zoneId"
                  aria-hidden="true"
                  >{{ routeMarkers.get(zoneId) }}</span
                >
                <span class="relative z-10">{{
                  cellText(getZone(zoneId)!, ancientForZone(zoneId, ancients))
                }}</span>
              </div>
              <div
                v-else
                class="map-cell flex min-h-[70px] items-center justify-center border border-dashed border-border/20 bg-bg-primary/30"
              >
                <span class="text-text-dim opacity-30">·</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="text-center t-hud-xs font-bold tracking-widest text-audit">AUDIT ▼</div>

      <div
        class="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-border pt-2 text-xs"
      >
        <span class="text-chaff">+NA = N Allies</span>
        <span class="text-audit">!NE = N Enemies</span>
        <span class="text-self">►YOU = You</span>
        <span class="text-text-dim">cN = N Waves</span>
        <span class="text-text-dim">☘N = N Neutrals</span>
        <span class="text-text-dim">▲▲▲/✗ = Ice HP</span>
        <span class="text-text-dim">◈ = Mainframe</span>
        <span class="text-self">⌖/N = Walk target / hop</span>
        <span class="text-text-dim">? = No vision</span>
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
          <span class="shrink-0 t-hud-xs font-bold tracking-widest text-self">►YOU</span>
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
          class="bg-chaff/10 min-h-[56px] w-full border-2 border-dashed border-chaff/60 px-3 py-2 text-left font-mono transition-all active:scale-[0.98] active:bg-chaff/20"
          :class="{ 'opacity-50': zone.fogged }"
          :aria-label="moveAriaLabel(zone)"
          @click="handleZoneClick(zone.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-bold text-text-primary">
              <span
                v-if="routeMarkers.get(zone.id)"
                class="text-self"
                :data-route-marker="zone.id"
                >{{ routeMarkers.get(zone.id) }}</span
              >
              {{ zone.name }}
            </span>
            <span class="shrink-0 t-hud-xs font-bold tracking-wider text-chaff">
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
        <!-- The thumbnail's own geometry (column headers and cells) is the one
             place exempt from the HUD type floor: ten columns of `RF T3 T2 T1
             RIV …` plus per-cell `T2▲▲▲►!` have to fit the rail's width, so
             flooring them at 12px would spill the grid instead of enlarging it.
             Everything around the grid — the orientation labels and the legend
             below — is prose and reads at the floor. -->
        <!-- Column headers derived from the active layout (5v5 / two_lane / one_lane). -->
        <div class="grid gap-px pb-0.5" :class="GRID_COLS">
          <span
            v-for="(hdr, hi) in MINI_COL_HEADERS"
            :key="hi"
            class="text-center font-mono text-[0.55rem] font-bold uppercase tracking-wider text-text-dim"
          >
            {{ hdr }}
          </span>
        </div>
        <!-- Chaff half is always the top of the grid, Audit the bottom. -->
        <div class="pb-0.5 text-center t-hud-xs font-bold tracking-widest text-chaff">CHAFF ▲</div>
        <div
          v-for="(row, ri) in miniRows"
          :key="ri"
          class="grid gap-px"
          :class="[GRID_COLS, { 'mb-1 border-b border-river/40 pb-1': ri === COMPACT_RIVER_ROW }]"
        >
          <template v-for="(cell, ci) in row" :key="ci">
            <div
              v-if="cell"
              class="map-cell-compact flex h-7 items-center justify-center font-mono text-[0.6rem]"
              :class="cell.classes"
            >
              <span>{{ cell.code }}</span>
              <span v-if="cell.ice" :class="cell.ice.cls">{{ cell.ice.harden }}</span>
              <span v-if="cell.marks">{{ cell.marks }}</span>
            </div>
            <div v-else class="map-cell-compact h-7 bg-bg-primary/30" />
          </template>
        </div>
        <div class="pt-0.5 text-center t-hud-xs font-bold tracking-widest text-audit">AUDIT ▼</div>
        <div class="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-0.5 t-hud-xs text-text-dim">
          <span>T1-3 ice zones</span>
          <span>JG jungle</span>
          <span>RN cache</span>
          <span>ROS Tenant</span>
          <span>RF/RB fountain/base</span>
          <span class="text-self">► you</span>
          <span class="text-audit">! enemies</span>
          <span>▲ ice up · ✗ razed</span>
          <span>◈✗ mainframe razed</span>
          <span>dimmed = no vision</span>
          <span
            ><span class="text-chaff">rad</span>/<span class="text-audit">audit</span> ground</span
          >
        </div>
      </div>
    </div>

    <div v-if="!zones.length" class="p-4 text-sm text-text-dim">&gt;_ loading map data...</div>
  </div>
</template>
