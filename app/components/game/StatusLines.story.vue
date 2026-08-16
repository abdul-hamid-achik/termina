<script setup lang="ts">
import type { TraceModel } from '~/components/game/traceModel'
import StatusLines from './StatusLines.vue'

const trace: TraceModel = {
  playerTeam: 'chaff',
  currentRoute: 'coldstore',
  hopIndex: 2,
  routes: [
    {
      route: 'coldstore',
      name: 'Coldstore',
      depth: 2,
      total: 5,
      hostiles: 1,
      seen: 3,
      active: true,
    },
    { route: 'seawall', name: 'Seawall', depth: 0, total: 5, hostiles: 0, seen: 5, active: false },
    {
      route: 'shallows',
      name: 'Shallows',
      depth: 0,
      total: 5,
      hostiles: 0,
      seen: 0,
      active: false,
    },
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
    <Variant title="cycle open">
      <div class="w-96 border border-border bg-bg-primary">
        <StatusLines
          :trace="trace"
          :hp-fraction="0.72"
          :alive="true"
          :cycle="240"
          :next-commit-at="Date.now() + 2700"
          :order-committed="false"
          :game-over="false"
          :enemy-count="1"
          :ally-headcount="1"
          :enemy-ice-present="false"
          :has-ready-ability="true"
          :rig-open="true"
          here="Daemon · 2 hostile waves"
          verb="STRIP"
          :strip-ready="true"
          move="Coldstore Crossing · T2 ?"
        />
      </div>
    </Variant>
    <Variant title="cycle committed">
      <div class="w-96 border border-border bg-bg-primary">
        <StatusLines
          :trace="trace"
          :hp-fraction="0.72"
          :alive="true"
          :cycle="240"
          :next-commit-at="Date.now() + 1400"
          :order-committed="true"
          :game-over="false"
          :enemy-count="1"
          :ally-headcount="1"
          :enemy-ice-present="false"
          :has-ready-ability="true"
          :rig-open="false"
          here="Daemon · 2 hostile waves"
          verb="HIT"
          :strip-ready="false"
          move="Coldstore Crossing · T2 ?"
        />
      </div>
    </Variant>
    <Variant title="cycle near-zero">
      <div class="w-96 border border-border bg-bg-primary">
        <StatusLines
          :trace="trace"
          :hp-fraction="0"
          :alive="false"
          :cycle="241"
          :next-commit-at="Date.now() + 80"
          :order-committed="false"
          :game-over="false"
          :enemy-count="2"
          :ally-headcount="0"
          :enemy-ice-present="true"
          :has-ready-ability="false"
          :rig-open="true"
          here="clear"
          :verb="null"
          :strip-ready="false"
          move="—"
        />
      </div>
    </Variant>
  </Story>
</template>
