<script setup lang="ts">
import { computed } from 'vue'
import type { TraceModel } from '~/components/game/traceModel'
import { FACTION_META } from '~~/shared/constants/world'

/**
 * The TRACE rail (C1a): your route as hop depth, one line per other route,
 * contacts, both terminals. No 2D board — a terminal shows what a terminal
 * can show: how deep you are, who is in contact, and whether the terminals
 * still stand.
 */
const props = defineProps<{ trace: TraceModel }>()

const currentLine = computed(() => {
  const active = props.trace.routes.find((r) => r.active)
  if (!active) return 'off route'
  return `${active.name.toUpperCase()} hop ${active.depth + 1}/${active.total}`
})
</script>

<template>
  <div class="flex flex-col gap-1 font-mono t-hud-sm" data-testid="trace-rail">
    <!-- Your route, as depth -->
    <div class="flex items-baseline gap-2" data-testid="trace-current">
      <span class="text-chaff">▸ {{ currentLine }}</span>
      <span v-if="trace.currentRoute" class="text-text-dim">
        {{ '┄'.repeat(Math.max(0, trace.hopIndex)) }}├┤{{ '┄'.repeat(2) }}
      </span>
    </div>

    <!-- The other routes, one line each -->
    <div
      v-for="r in trace.routes.filter((r) => !r.active)"
      :key="r.route"
      class="flex items-baseline gap-2 text-text-dim"
      :data-testid="`trace-route-${r.route}`"
    >
      <span>{{ r.name }}</span>
      <span v-if="r.hostiles" class="text-audit">· {{ r.hostiles }} hostile</span>
      <span v-else>· quiet</span>
    </div>

    <!-- Contacts -->
    <div v-if="trace.contacts.length" class="mt-1 border-t border-border/50 pt-1">
      <div
        v-for="c in trace.contacts"
        :key="c.id"
        class="flex items-baseline gap-1.5"
        :class="c.hostile ? 'text-audit' : 'text-chaff'"
        :data-testid="`trace-contact-${c.id}`"
      >
        <span>{{ c.hostile ? '✕' : '○' }}</span>
        <span>{{ c.name }}</span>
        <span class="text-text-dim">@ {{ c.zoneName }}</span>
      </div>
    </div>

    <!-- Both terminals -->
    <div class="mt-1 flex gap-3 border-t border-border/50 pt-1" data-testid="trace-terminals">
      <span
        v-for="t in trace.terminals"
        :key="t.team"
        :class="t.alive ? 'text-chaff' : 'text-audit line-through'"
        :data-testid="`trace-terminal-${t.team}`"
      >
        {{ FACTION_META[t.team].short }}
        <template v-if="t.alive">
          {{ t.hp }}/{{ t.maxHp }}<template v-if="t.vulnerable"> ⚠</template></template
        >
        <template v-else> DOWN</template>
      </span>
    </div>
  </div>
</template>
