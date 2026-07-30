<script setup lang="ts">
import type { TraceModel } from '~/components/game/traceModel'
import TraceRail from './TraceRail.vue'

const sample: TraceModel = {
  currentRoute: 'mid',
  hopIndex: 2,
  routes: [
    { route: 'mid', name: 'Coldstore', depth: 2, total: 5, hostiles: 1, active: true },
    { route: 'top', name: 'Seawall', depth: 0, total: 5, hostiles: 0, active: false },
    { route: 'bot', name: 'Shallows', depth: 0, total: 5, hostiles: 2, active: false },
  ],
  contacts: [
    {
      id: 'e1',
      name: 'regex_mid',
      zone: 'mid-river',
      zoneName: 'Coldstore Crossing',
      hostile: true,
    },
    {
      id: 'a1',
      name: 'kernel_main',
      zone: 'mid-t1-chaff',
      zoneName: 'Coldstore T1',
      hostile: false,
    },
  ],
  terminals: [
    { team: 'chaff', alive: true, vulnerable: false, integ: 3000, maxInteg: 3000 },
    { team: 'audit', alive: true, vulnerable: true, integ: 2100, maxInteg: 3000 },
  ],
}
</script>

<template>
  <Story title="game/TraceRail">
    <Variant title="mid-route with contacts">
      <div class="w-72 border border-border bg-bg-primary p-2">
        <TraceRail :trace="sample" />
      </div>
    </Variant>
  </Story>
</template>
