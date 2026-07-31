<script setup lang="ts">
import { computed } from 'vue'
import HeroPortrait from '~/components/avatars/HeroPortrait.vue'
import { DAY_DURATION_CYCLES, NIGHT_DURATION_CYCLES } from '~~/shared/constants/balance'
import { FACTION_META } from '~~/shared/constants/world'
import type { TeamState, TerminalState } from '~~/shared/types/game'
import { scripLead, formatScripShort, dayNightReadout } from '~/utils/strategy'
import { formatSeconds } from '~/utils/gameClock'

const props = defineProps<{
  cycle: number
  gameTime: string
  scrip: number
  kills: number
  deaths: number
  assists: number
  heroId?: string
  connected?: boolean
  reconnecting?: boolean
  latency?: number
  timeOfDay?: 'day' | 'night'
  dayNightCycle?: number
  /** Team-level macro state (renders the always-on macro row when present). */
  teams?: { chaff: TeamState; audit: TeamState } | null
  terminals?: { chaff: TerminalState; audit: TerminalState } | null
  netWorthChaff?: number
  netWorthAudit?: number
  /** Bumped by the parent when the local player scores a kill → KDA pop. */
  kdaPopKey?: number
}>()

// The bar shows no cycle countdown — the combat log's theater header is the
// game's single clock (four duplicate countdowns was a legibility complaint).

function formatScrip(n: number): string {
  return n.toLocaleString()
}

// Surface WHY night matters on the always-visible bar (the transient combat-log
// "vision reduced" line scrolls away). Helps new players connect the chip to the
// vision change. Reuses dayNightReadout so the isNight semantics stay canonical.
const dayNightTitle = computed(() => {
  if (!props.timeOfDay) return undefined
  return dayNightReadout(props.timeOfDay).isNight
    ? 'Night — your vision is reduced to fewer adjacent zones'
    : 'Day — full vision range'
})

function formatTimeRemaining(cycle: number, timeOfDay: string): string {
  const totalTicks = timeOfDay === 'day' ? DAY_DURATION_CYCLES : NIGHT_DURATION_CYCLES
  const remaining = totalTicks - cycle
  const seconds = Math.ceil(remaining * 4)
  return formatSeconds(seconds)
}

// ── Macro row (team score / net worth / ice / Core INTEG) ──────
const lead = computed(() => scripLead(props.netWorthChaff ?? 0, props.netWorthAudit ?? 0))

function corePct(a: TerminalState | undefined): number {
  if (!a || a.maxInteg <= 0) return 0
  return Math.round((a.integ / a.maxInteg) * 100)
}
</script>

<template>
  <div class="flex flex-col border-b border-border bg-bg-secondary" data-testid="game-state-bar">
    <!-- Row 1: self state + cycle heartbeat -->
    <div
      class="flex items-center gap-2 overflow-x-auto px-3 py-1.5 text-[0.8rem] whitespace-nowrap t-mono-num"
    >
      <HeroPortrait v-if="heroId" :hero-id="heroId" :size="24" />
      <span class="inline-flex gap-1">
        <span class="t-caption">Cycle</span>
        <span class="text-text-primary">{{ cycle }}</span>
      </span>
      <span class="text-border">|</span>
      <span class="inline-flex gap-1">
        <span class="text-text-primary text-glow-sm">{{ gameTime }}</span>
      </span>
      <span class="text-border">|</span>
      <span class="inline-flex items-center gap-1" :title="dayNightTitle">
        <span v-if="timeOfDay === 'day'" class="text-gold text-glow-gold">Day</span>
        <span v-else class="text-self text-glow-sm">Night</span>
        <span v-if="dayNightCycle !== undefined && timeOfDay" class="t-caption">
          ({{ formatTimeRemaining(dayNightCycle, timeOfDay) }})
        </span>
      </span>
      <span class="text-border">|</span>
      <span class="inline-flex gap-1">
        <span class="t-caption">Scrip</span>
        <span class="text-gold text-glow-gold font-bold">{{ formatScrip(scrip) }}</span>
      </span>
      <span class="text-border">|</span>
      <span class="inline-flex gap-1">
        <span class="t-caption">KDA</span>
        <span :key="kdaPopKey" class="anim-pop inline-block">
          <span class="text-chaff text-glow-chaff font-bold">{{ kills }}</span
          ><span class="text-text-muted">/</span
          ><span class="text-audit text-glow-audit font-bold">{{ deaths }}</span
          ><span class="text-text-muted">/</span
          ><span class="text-text-dim font-bold">{{ assists }}</span>
        </span>
      </span>
      <span class="text-border">|</span>
      <span v-if="reconnecting" class="text-audit text-glow-audit animate-pulse"
        >[RECONNECTING...]</span
      >
      <span v-else-if="connected" class="text-chaff text-glow-sm">[ONLINE {{ latency }}ms]</span>
      <span v-else class="text-text-muted">[OFFLINE]</span>
    </div>

    <!-- Row 2: always-on team macro state -->
    <div
      v-if="teams"
      class="flex items-center gap-3 overflow-x-auto border-t border-border/50 bg-bg-primary/40 px-3 py-1 text-[0.72rem] whitespace-nowrap t-mono-num"
      data-testid="macro-strip"
    >
      <!-- Team kill score -->
      <span class="inline-flex items-center gap-1.5">
        <span class="font-bold tracking-widest text-chaff text-glow-chaff">{{
          teams.chaff.kills
        }}</span>
        <span class="text-[0.6rem] text-text-dim"
          >{{ FACTION_META.chaff.short }}&nbsp;·&nbsp;{{ FACTION_META.audit.short }}</span
        >
        <span class="font-bold tracking-widest text-audit text-glow-audit">{{
          teams.audit.kills
        }}</span>
      </span>
      <span class="text-border">|</span>
      <!-- Net worth lead -->
      <span class="inline-flex items-center gap-1" data-testid="networth-lead">
        <span class="t-caption">NET</span>
        <span
          v-if="lead.leader"
          :class="lead.leader === 'chaff' ? 'text-chaff' : 'text-audit'"
          class="font-bold"
          >{{ FACTION_META[lead.leader].short }} +{{ formatScripShort(lead.amount) }}</span
        >
        <span v-else class="text-text-dim">even</span>
      </span>
      <span class="text-border">|</span>
      <!-- ICE destroyed -->
      <span class="inline-flex items-center gap-1">
        <span class="t-caption">ICE</span>
        <span class="text-chaff">{{ teams.chaff.iceKills }}</span
        ><span class="text-text-muted">/</span
        ><span class="text-audit">{{ teams.audit.iceKills }}</span>
      </span>
      <template v-if="terminals">
        <span class="text-border">|</span>
        <!-- Terminal INTEG — turns urgent once vulnerable -->
        <span class="inline-flex items-center gap-1">
          <span class="t-caption">TERMINAL</span>
          <span
            :class="terminals.chaff.vulnerable ? 'text-warn animate-pulse font-bold' : 'text-chaff'"
            >{{ FACTION_META.chaff.short }} {{ corePct(terminals.chaff) }}%</span
          >
          <span class="text-text-muted">/</span>
          <span
            :class="terminals.audit.vulnerable ? 'text-warn animate-pulse font-bold' : 'text-audit'"
            >{{ FACTION_META.audit.short }} {{ corePct(terminals.audit) }}%</span
          >
        </span>
      </template>
    </div>
  </div>
</template>
