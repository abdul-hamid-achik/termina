<script setup lang="ts">
import type { TraceModel } from '~/components/game/traceModel'
import StatusLines from './StatusLines.vue'

const trace: TraceModel = {
  currentRoute: 'mid',
  hopIndex: 2,
  routes: [
    { route: 'mid', name: 'Coldstore', depth: 2, total: 5, hostiles: 1, active: true },
    { route: 'top', name: 'Seawall', depth: 0, total: 5, hostiles: 0, active: false },
    { route: 'bot', name: 'Shallows', depth: 0, total: 5, hostiles: 0, active: false },
  ],
  contacts: [],
  terminals: [
    { team: 'chaff', alive: true, vulnerable: false, integ: 3000, maxInteg: 3000 },
    { team: 'audit', alive: true, vulnerable: false, integ: 3000, maxInteg: 3000 },
  ],
}
</script>

<template>
  <Story title="game/StatusLines">
    <Variant title="awaiting orders">
      <div class="w-96 border border-border bg-bg-primary">
        <StatusLines
          :trace="trace"
          :hp-fraction="0.72"
          :alive="true"
          net-lead="CHF +1.2k"
          :next-tick-in="3"
          :tick="240"
          :can-act="true"
          :enemy-count="1"
          :ally-headcount="1"
          :enemy-ice-present="false"
          :has-ready-ability="true"
        />
      </div>
    </Variant>
    <Variant title="down">
      <div class="w-96 border border-border bg-bg-primary">
        <StatusLines
          :trace="trace"
          :hp-fraction="0"
          :alive="false"
          net-lead="even"
          :next-tick-in="0"
          :tick="241"
          :can-act="false"
          :enemy-count="2"
          :ally-headcount="0"
          :enemy-ice-present="true"
          :has-ready-ability="false"
        />
      </div>
    </Variant>
  </Story>
</template>
