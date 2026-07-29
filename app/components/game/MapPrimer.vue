<script setup lang="ts">
import { ref, computed } from 'vue'
import AsciiMap from './AsciiMap.vue'
import { buildMapPrimerZones } from '~/utils/mapPrimer'
import { ZONE_MAP } from '~~/shared/constants/zones'

/**
 * An interactive, no-game map primer for /learn — renders the real in-game
 * AsciiMap over a static, fully-revealed topology so a newcomer can SEE the
 * zones, lanes, river, jungle, bases and Roshan, and learn the movement rule
 * by feel: every zone is clickable (a real game auto-paths you there one zone
 * per tick), adjacent zones glow brighter because those arrive next tick. The
 * primer teleports the explorer to whatever they click — a real game walks.
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
  // Any zone is a legal order (auto-path); the primer just jumps the explorer
  // there so the topology can be browsed quickly.
  selected.value = id
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="map-primer">
    <!-- The full desktop grid is ~740px of cells plus header/legend chrome, so a
         fixed 460px box showed a new player the Radiant half and cut the map in
         two — the one surface on /learn whose entire job is "here is the board".
         Viewport-relative with a ceiling so it still fits a laptop. -->
    <div
      class="h-[min(78vh,820px)] min-h-[420px] border border-border bg-bg-primary"
      data-testid="map-primer-frame"
    >
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
        adjacentCount === 1 ? ' arrives' : 's arrive'
      }}
      next tick (bright dashed). In a game you can order a move to ANY zone — your hero walks there
      one zone per tick.
    </p>
  </div>
</template>
