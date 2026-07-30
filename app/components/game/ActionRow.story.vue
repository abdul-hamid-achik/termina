<script setup lang="ts">
import type { ZoneDisplay } from '~/components/game/traceModel'
import ActionRow from './ActionRow.vue'

const moveZones: ZoneDisplay[] = [
  {
    id: 'mid-river',
    name: 'Coldstore Crossing',
    playerHere: false,
    allies: [],
    enemyCount: 0,
    fogged: false,
  },
  {
    id: 'mid-t1-chaff',
    name: 'Coldstore T1',
    playerHere: false,
    allies: [],
    enemyCount: 1,
    fogged: false,
  },
]

const situational = [
  { cmd: 'attack wave:0', label: 'STRIP', aria: 'Attack the lowest-INTEG hostile wave' },
  { cmd: 'burn', label: 'BURN', aria: 'Burn a friendly wave' },
]
</script>

<template>
  <Story title="game/ActionRow">
    <Variant title="default strip">
      <div class="w-full max-w-lg border border-border bg-bg-primary p-2">
        <ActionRow
          :move-zones="moveZones"
          :situational="situational"
          :abilities="{ Q: { label: 'Q', ready: true }, W: { label: 'W·2', ready: false } }"
          :ability-arias="{}"
          :shop-open="false"
          :scoreboard-open="false"
          :can-buy="true"
        />
      </div>
    </Variant>
  </Story>
</template>
