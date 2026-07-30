<script setup lang="ts">
import { computed } from 'vue'
import HeroAvatar from '~/components/avatars/HeroAvatar.vue'
import { DAY_DURATION_TICKS, NIGHT_DURATION_TICKS } from '~~/shared/constants/balance'
import type { TeamState, AncientState } from '~~/shared/types/game'
import { goldLead, formatGoldShort, dayNightReadout } from '~/utils/strategy'
import { formatSeconds } from '~/utils/gameClock'

const props = defineProps<{
  tick: number
  gameTime: string
  gold: number
  kills: number
  deaths: number
  assists: number
  heroId?: string
  connected?: boolean
  reconnecting?: boolean
  latency?: number
  timeOfDay?: 'day' | 'night'
  dayNightTick?: number
  /** Team-level macro state (renders the always-on macro row when present). */
  teams?: { chaff: TeamState; audit: TeamState } | null
  ancients?: { chaff: AncientState; audit: AncientState } | null
  netWorthChaff?: number
  netWorthAudit?: number
  /** Bumped by the parent when the local player scores a kill → KDA pop. */
  kdaPopKey?: number
}>()

// The bar shows no tick countdown — the combat log's theater header is the
// game's single clock (four duplicate countdowns was a legibility complaint).

function formatGold(n: number): string {
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

function formatTimeRemaining(tick: number, timeOfDay: string): string {
  const totalTicks = timeOfDay === 'day' ? DAY_DURATION_TICKS : NIGHT_DURATION_TICKS
  const remaining = totalTicks - tick
  const seconds = Math.ceil(remaining * 4)
  return formatSeconds(seconds)
}

// ── Macro row (team score / net worth / towers / Core HP) ──────
const lead = computed(() => goldLead(props.netWorthChaff ?? 0, props.netWorthAudit ?? 0))

function corePct(a: AncientState | undefined): number {
  if (!a || a.maxHp <= 0) return 0
  return Math.round((a.hp / a.maxHp) * 100)
}
</script>

<template>
  <div class="flex flex-col border-b border-border bg-bg-secondary" data-testid="game-state-bar">
    <!-- Row 1: self state + tick heartbeat -->
    <div
      class="flex items-center gap-2 overflow-x-auto px-3 py-1.5 text-[0.8rem] whitespace-nowrap t-mono-num"
    >
      <HeroAvatar v-if="heroId" :hero-id="heroId" :size="24" />
      <span class="inline-flex gap-1">
        <span class="t-caption">Cycle</span>
        <span class="text-text-primary">{{ tick }}</span>
      </span>
      <span class="text-border">|</span>
      <span class="inline-flex gap-1">
        <span class="text-text-primary text-glow-sm">{{ gameTime }}</span>
      </span>
      <span class="text-border">|</span>
      <span class="inline-flex items-center gap-1" :title="dayNightTitle">
        <span v-if="timeOfDay === 'day'" class="text-gold text-glow-gold">Day</span>
        <span v-else class="text-self text-glow-sm">Night</span>
        <span v-if="dayNightTick !== undefined && timeOfDay" class="t-caption">
          ({{ formatTimeRemaining(dayNightTick, timeOfDay) }})
        </span>
      </span>
      <span class="text-border">|</span>
      <span class="inline-flex gap-1">
        <span class="t-caption">Gold</span>
        <span class="text-gold text-glow-gold font-bold">{{ formatGold(gold) }}</span>
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
        <span class="text-[0.6rem] text-text-dim">RAD&nbsp;·&nbsp;AUDIT</span>
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
          >{{ lead.leader === 'chaff' ? 'RAD' : 'AUDIT' }} +{{ formatGoldShort(lead.amount) }}</span
        >
        <span v-else class="text-text-dim">even</span>
      </span>
      <span class="text-border">|</span>
      <!-- Towers destroyed -->
      <span class="inline-flex items-center gap-1">
        <span class="t-caption">TWR</span>
        <span class="text-chaff">{{ teams.chaff.towerKills }}</span
        ><span class="text-text-muted">/</span
        ><span class="text-audit">{{ teams.audit.towerKills }}</span>
      </span>
      <template v-if="ancients">
        <span class="text-border">|</span>
        <!-- Mainframe HP — turns urgent once vulnerable -->
        <span class="inline-flex items-center gap-1">
          <span class="t-caption">MAINFRAME</span>
          <span
            :class="ancients.chaff.vulnerable ? 'text-warn animate-pulse font-bold' : 'text-chaff'"
            >R {{ corePct(ancients.chaff) }}%</span
          >
          <span class="text-text-muted">/</span>
          <span
            :class="ancients.audit.vulnerable ? 'text-warn animate-pulse font-bold' : 'text-audit'"
            >D {{ corePct(ancients.audit) }}%</span
          >
        </span>
      </template>
    </div>
  </div>
</template>
