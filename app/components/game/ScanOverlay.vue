<script setup lang="ts">
import TraceRail from '~/components/game/TraceRail.vue'
import type { TraceModel, ZoneDisplay } from '~/components/game/traceModel'

/**
 * Brief look at the ground. `map` is hops from here; `scan` is what is
 * standing in this zone and the commands that hit it. Informational — does
 * not spend the cycle. Click a hop or a verb to issue it.
 */
const props = defineProps<{
  mode: 'map' | 'scan'
  zoneName: string
  readout: string[]
  moves: ZoneDisplay[]
  attacks: { cmd: string; label: string }[]
  trace: TraceModel
}>()

const emit = defineEmits<{
  close: []
  command: [cmd: string]
}>()

function hop(zone: ZoneDisplay) {
  emit('command', `move ${zone.id}`)
}
</script>

<template>
  <div
    class="flex max-h-[85vh] w-full max-w-lg flex-col border border-border bg-bg-primary"
    data-testid="scan-overlay"
    :data-mode="mode"
  >
    <div class="flex items-center justify-between border-b border-border px-3 py-1.5">
      <span class="font-mono text-[0.85rem] font-bold tracking-wider text-ability">
        &gt;_ {{ mode === 'map' ? 'MAP' : 'SCAN' }}
        <span class="font-normal text-text-dim">· {{ zoneName }}</span>
      </span>
      <button
        type="button"
        class="border border-border px-2 py-0.5 font-mono t-hud-sm text-text-dim hover:text-text-primary"
        data-testid="scan-overlay-close"
        @click="emit('close')"
      >
        [CLOSE]
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <div class="mb-2 border border-border bg-bg-secondary/40 p-2">
        <TraceRail :trace="trace" compact />
      </div>

      <div v-if="mode === 'scan' && attacks.length" class="mb-2 flex flex-wrap gap-1">
        <button
          v-for="a in attacks"
          :key="a.cmd"
          type="button"
          class="border border-ability/50 bg-ability/10 px-2 py-1 font-mono text-[0.72rem] text-ability hover:bg-ability/20"
          :data-testid="`scan-attack-${a.cmd}`"
          @click="emit('command', a.cmd)"
        >
          {{ a.label }}
        </button>
      </div>

      <div
        v-if="moves.length"
        class="mb-2 flex flex-wrap gap-1"
        data-testid="scan-moves"
        role="group"
        aria-label="Reachable this cycle"
      >
        <button
          v-for="z in moves"
          :key="z.id"
          type="button"
          class="border border-chaff/50 bg-bg-secondary px-2 py-1 font-mono text-[0.72rem] text-chaff hover:border-chaff"
          :data-testid="`scan-move-${z.id}`"
          @click="hop(z)"
        >
          ▸ {{ z.name }}<span v-if="z.enemyCount" class="ml-1 text-warn">⚠{{ z.enemyCount }}</span>
          <span v-else-if="z.fogged" class="ml-1 text-text-muted">?</span>
        </button>
      </div>

      <pre
        class="whitespace-pre-wrap font-mono text-[0.72rem] leading-relaxed text-text-dim"
        data-testid="scan-readout"
        >{{ readout.join('\n') }}</pre
      >
    </div>
  </div>
</template>
