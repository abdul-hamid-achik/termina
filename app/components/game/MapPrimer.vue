<script setup lang="ts">
import { ref, computed } from 'vue'
import AsciiMap from './AsciiMap.vue'
import { buildMapPrimerZones } from '~/utils/mapPrimer'
import { ZONE_MAP } from '~~/shared/constants/zones'

/**
 * An interactive, no-game map primer for /learn — renders the real in-game
 * AsciiMap over a static, fully-revealed topology so a newcomer can SEE the
 * zones, lanes, river, jungle, bases and Roshan, and learn the core movement
 * rule by feel: AsciiMap only makes adjacent zones clickable, so each click
 * "hops" the explorer exactly one zone — the one-adjacent-zone-per-tick rule
 * made tangible before they ever queue.
 */
const zones = buildMapPrimerZones()

// Start the explorer at the Radiant fountain (where a real game begins).
const selected = ref('radiant-fountain')
// Mark the explorer's current zone so AsciiMap highlights it + opens its
// adjacent zones as clickable move targets.
const displayZones = computed(() =>
  zones.map((z) => (z.id === selected.value ? { ...z, playerHere: true } : z)),
)
const selectedName = computed(() => ZONE_MAP[selected.value]?.name ?? selected.value)
const adjacentCount = computed(() => ZONE_MAP[selected.value]?.adjacentTo.length ?? 0)

function onZoneClick(id: string) {
  // AsciiMap only emits for adjacent (clickable) zones, so this is always a
  // single legal hop — exactly what a move command does in a real game.
  selected.value = id
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="map-primer">
    <div class="h-[460px] border border-border bg-bg-primary max-sm:h-[520px]">
      <AsciiMap
        :zones="displayZones"
        :player-zone="selected"
        :ancients="null"
        @zone-click="onZoneClick"
      />
    </div>
    <p class="text-[0.75rem] text-text-dim" data-testid="map-primer-caption">
      Standing in <span class="text-self">{{ selectedName }}</span> —
      <span class="text-radiant">{{ adjacentCount }}</span> adjacent zone{{
        adjacentCount === 1 ? '' : 's'
      }}
      reachable next tick. Click a highlighted (dashed) zone to hop there, one zone per tick.
    </p>
  </div>
</template>
