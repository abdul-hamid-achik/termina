<script setup lang="ts">
import { ref, computed } from 'vue'
import TraceRail from './TraceRail.vue'
import { buildTrace } from './traceModel'
import { ZONE_MAP, ZONES } from '~~/shared/constants/zones'

/**
 * An interactive, no-game topology primer for /learn — the trace over the real
 * zone records so a newcomer can read the routes as depth and learn the
 * movement rule by feel: click any zone to hop there (a real game auto-paths
 * one zone per tick). The primer teleports the explorer; a real game walks.
 */

// Every zone, browsable. Grouped by the zone record's own type.
const BY_TYPE = computed(() => {
  const groups: Record<string, string[]> = {}
  for (const z of ZONES) {
    const key =
      z.type === 'fountain' || z.type === 'base'
        ? 'terminals'
        : z.type === 'river'
          ? 'crossings & caches'
          : z.type === 'objective'
            ? 'objectives'
            : z.type === 'jungle'
              ? 'the Silt'
              : `${z.lane ?? '?'} route`
    ;(groups[key] ??= []).push(z.id)
  }
  return groups
})

// Start the explorer at the Chaff fountain (where a real game begins).
const selected = ref('chaff-fountain')
const selectedZone = computed(() => ZONE_MAP[selected.value]!)
const selectedName = computed(() => selectedZone.value.name)
const adjacent = computed(() => selectedZone.value.adjacentTo)

const trace = computed(() =>
  buildTrace({
    playerZone: selected.value,
    playerTeam: 'chaff',
    contacts: [],
    ancients: {
      chaff: { team: 'chaff', hp: 6000, maxHp: 6000, alive: true, vulnerable: false },
      audit: { team: 'audit', hp: 6000, maxHp: 6000, alive: true, vulnerable: false },
    },
  }),
)

function onZoneClick(id: string) {
  selected.value = id
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="map-primer">
    <div class="border border-border bg-bg-primary p-2" data-testid="map-primer-frame">
      <TraceRail :trace="trace" />
    </div>

    <!-- Adjacent zones: what arrives next tick — clickable to hop. -->
    <div
      class="flex flex-wrap gap-1"
      data-testid="map-primer-adjacent"
      role="group"
      aria-label="Adjacent zones"
    >
      <button
        v-for="id in adjacent"
        :key="id"
        type="button"
        class="border border-chaff/50 bg-bg-secondary px-2 py-1 font-mono text-[0.72rem] text-chaff transition-all hover:border-chaff"
        :data-testid="`primer-zone-${id}`"
        @click="onZoneClick(id)"
      >
        ▸ {{ ZONE_MAP[id]?.name ?? id }}
      </button>
    </div>

    <!-- The whole topology, grouped by zone type — every zone clickable. -->
    <div class="flex flex-col gap-1 border-t border-border/50 pt-1.5">
      <div v-for="(ids, group) in BY_TYPE" :key="group" class="flex flex-wrap items-baseline gap-1">
        <span class="w-32 shrink-0 text-[0.62rem] uppercase tracking-wider text-text-muted">{{
          group
        }}</span>
        <button
          v-for="id in ids"
          :key="id"
          type="button"
          class="px-1 font-mono text-[0.68rem] transition-colors"
          :class="id === selected ? 'text-self font-bold' : 'text-text-dim hover:text-text-primary'"
          :data-testid="`primer-all-${id}`"
          @click="onZoneClick(id)"
        >
          {{ ZONE_MAP[id]?.name ?? id }}
        </button>
      </div>
    </div>

    <p class="text-[0.75rem] text-text-dim" data-testid="map-primer-caption">
      Standing in <span class="text-self">{{ selectedName }}</span> —
      <span class="text-chaff">{{ adjacent.length }}</span> adjacent zone{{
        adjacent.length === 1 ? ' arrives' : 's arrive'
      }}
      next tick (bright dashed). In a game you can order a move to ANY zone — your hero walks there
      one zone per tick.
    </p>
  </div>
</template>
