<script setup lang="ts">
import { computed } from 'vue'
import type { TraceModel } from '~/components/game/traceModel'
import { FACTION_META } from '~~/shared/constants/world'
import type { TeamId } from '~~/shared/types/game'

/**
 * The TRACE rail (C1a): your route as hop depth, one line per other route,
 * contacts, both terminals. No 2D board — a terminal shows what a terminal
 * can show: how deep you are, who is in contact, and whether the terminals
 * still stand.
 */
const props = defineProps<{
  trace: TraceModel
  /** Cut HUD: skip blind other-route lines; wrap terminals so they don't collide. */
  compact?: boolean
}>()

function teamTextClass(team: TeamId): string {
  return team === 'chaff' ? 'text-chaff' : 'text-audit'
}

const currentRouteClass = computed(() => teamTextClass(props.trace.playerTeam))

const activeRoute = computed(() => props.trace.routes.find((r) => r.active))

const currentLine = computed(() => {
  const active = activeRoute.value
  if (!active) return 'off route'
  return `${active.name.toUpperCase()} hop ${active.depth + 1}/${active.total}`
})

/**
 * The depth bar. It used to draw `'┄'.repeat(depth) + '├┤' + '┄┄'` — a fixed
 * two-glyph tail, so the ground still ahead of you was drawn the same at hop
 * 1/8 as at hop 7/8. Both sides are now real: behind you, and left to go.
 */
const depthBar = computed(() => {
  const active = activeRoute.value
  if (!active) return ''
  const behind = Math.max(0, active.depth)
  const ahead = Math.max(0, active.total - active.depth - 1)
  return `${'┄'.repeat(behind)}├┤${'┄'.repeat(ahead)}`
})

/**
 * What a route line is allowed to claim. Absence of contacts is NOT safety:
 * a route you hold no vision on reports zero hostiles exactly like a warded,
 * confirmed-empty one. "no feed" says the line is blind; "clear" is only
 * spoken for ground the team can actually see.
 */
function routeStatus(r: { hostiles: number; seen: number; total: number }): {
  text: string
  tone: 'hostile' | 'blind' | 'clear'
} {
  if (r.hostiles) return { text: `${r.hostiles} hostile`, tone: 'hostile' }
  if (r.seen === 0) return { text: 'no feed', tone: 'blind' }
  if (r.seen < r.total) return { text: `clear ${r.seen}/${r.total}`, tone: 'clear' }
  return { text: 'clear', tone: 'clear' }
}
</script>

<template>
  <div class="flex flex-col gap-1 font-mono t-hud-sm" data-testid="trace-rail">
    <!-- Your route, as depth. Its own contact count is shown too: the route you
         are standing on is the one whose hostiles matter most, and it was the
         only line that never reported them. -->
    <div
      class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
      data-testid="trace-current"
    >
      <span :class="currentRouteClass">▸ {{ currentLine }}</span>
      <span v-if="trace.currentRoute" class="text-text-dim">{{ depthBar }}</span>
      <span
        v-if="activeRoute?.hostiles"
        class="text-warn"
        :data-testid="`trace-route-${activeRoute.route}-status`"
        >· {{ activeRoute.hostiles }} hostile</span
      >
      <template v-if="compact">
        <span
          v-for="t in trace.terminals"
          :key="`inline-${t.team}`"
          class="whitespace-nowrap text-text-dim"
          :class="[teamTextClass(t.team), { 'line-through': !t.alive }]"
        >
          {{ FACTION_META[t.team].short }}
          <template v-if="t.alive">{{ t.integ }}/{{ t.maxInteg }}</template>
          <template v-else>DOWN</template>
        </span>
      </template>
    </div>

    <!-- The other routes, one line each. Compact only keeps a line that is
         actually threatened — "clear 1/8" on two distant routes ate the
         identity strip on a cut pane. -->
    <div
      v-for="r in trace.routes.filter((r) => !r.active && (!compact || r.hostiles > 0))"
      :key="r.route"
      class="flex items-baseline gap-2 text-text-dim"
      :data-testid="`trace-route-${r.route}`"
    >
      <span>{{ r.name.toUpperCase() }}</span>
      <span
        :class="{
          'text-warn': routeStatus(r).tone === 'hostile',
          'text-text-muted italic': routeStatus(r).tone === 'blind',
        }"
        :data-testid="`trace-route-${r.route}-status`"
        >· {{ routeStatus(r).text }}</span
      >
    </div>

    <!-- Contacts -->
    <div v-if="trace.contacts.length" class="mt-1 border-t border-border/50 pt-1">
      <div
        v-for="c in trace.contacts"
        :key="c.id"
        class="flex items-baseline gap-1.5"
        :class="teamTextClass(c.team)"
        :data-testid="`trace-contact-${c.id}`"
      >
        <span>{{ c.hostile ? '✕' : '○' }}</span>
        <span>{{ c.name }}</span>
        <span class="text-text-dim">@ {{ c.zoneName }}</span>
      </div>
    </div>

    <!-- Both terminals -->
    <div
      v-if="!compact"
      class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border/50 pt-1"
      data-testid="trace-terminals"
    >
      <span
        v-for="t in trace.terminals"
        :key="t.team"
        class="whitespace-nowrap"
        :class="[teamTextClass(t.team), { 'line-through': !t.alive }]"
        :data-testid="`trace-terminal-${t.team}`"
      >
        {{ FACTION_META[t.team].short }}
        <template v-if="t.alive">
          {{ t.integ }}/{{ t.maxInteg }}<template v-if="t.vulnerable"> ⚠</template></template
        >
        <template v-else> DOWN</template>
      </span>
    </div>
  </div>
</template>
