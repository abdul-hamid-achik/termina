<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '~/stores/game'
import { HEROES } from '~~/shared/constants/heroes'
import { goldLead, formatGoldShort, visionSummary, dayNightReadout } from '~/utils/strategy'
import ObjectiveTicker from '~/components/game/ObjectiveTicker.vue'
import EnemyThreatSheet from '~/components/game/EnemyThreatSheet.vue'
import Sparkline from '~/components/game/Sparkline.vue'

/**
 * Store-connected War Room container — the strategic dashboard that surfaces
 * everything a text MOBA can uniquely show: net-worth lead + trend, the
 * objective layer (Roshan/runes/aegis), the enemy threat sheet (cooldowns,
 * respawns, last-seen), day/night meaning and vision coverage. Leaf panels are
 * pure/prop-based; this wires the store into them.
 */
const store = useGameStore()

const tick = computed(() => store.tick)

// The aegis carrier is whoever holds the 'aegis' buff (the engine clears the
// ground aegis to null on pickup), resolved to a readable name + countdown.
const aegisHolder = computed(() => {
  for (const p of Object.values(store.allPlayers)) {
    const buff = (p.buffs ?? []).find((b) => b.id === 'aegis')
    if (buff) {
      const name = (p.heroId && HEROES[p.heroId]?.name) || p.name
      return { name, ticksRemaining: buff.ticksRemaining }
    }
  }
  return null
})

// Net-worth lead + trend (lead series = radiant - dire over recent ticks).
const lead = computed(() => goldLead(store.netWorth.radiant, store.netWorth.dire))
const leadSeries = computed(() => {
  const r = store.netWorthHistory.radiant
  const d = store.netWorthHistory.dire
  const n = Math.min(r.length, d.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((r[i] ?? 0) - (d[i] ?? 0))
  return out
})
const leadColorVar = computed(() =>
  lead.value.leader === 'radiant'
    ? 'color-radiant'
    : lead.value.leader === 'dire'
      ? 'color-dire'
      : 'text-dim',
)

// Vision coverage + ward expiry (own-team wards in currently-visible zones).
const vision = computed(() => {
  const myTeam = store.player?.team
  const wards = Object.values(store.visibleZones)
    .flatMap((z) => z.wards ?? [])
    .filter((w) => !myTeam || w.team === myTeam)
  return visionSummary(Object.keys(store.visibleZones), wards, store.tick)
})

const dayNight = computed(() => dayNightReadout(store.timeOfDay))
</script>

<template>
  <div data-testid="war-room" class="flex h-full min-h-0 flex-col gap-2 p-1 text-[0.72rem]">
    <!-- Net worth lead + trend -->
    <section class="shrink-0">
      <div class="mb-0.5 flex items-center justify-between">
        <span class="text-[0.6rem] font-bold tracking-wider text-text-dim uppercase">Net Worth</span>
        <Sparkline :values="leadSeries" :color-var="leadColorVar" class="text-[0.7rem]" />
      </div>
      <div class="flex items-baseline gap-1 font-mono">
        <span v-if="lead.leader" :class="lead.leader === 'radiant' ? 'text-radiant' : 'text-dire'" class="font-bold">
          {{ lead.leader === 'radiant' ? 'RAD' : 'DIRE' }} +{{ formatGoldShort(lead.amount) }}
        </span>
        <span v-else class="text-text-dim">even</span>
      </div>
    </section>

    <!-- Objectives -->
    <section class="shrink-0 border-t border-border/50 pt-1.5">
      <div class="mb-0.5 text-[0.6rem] font-bold tracking-wider text-text-dim uppercase">Objectives</div>
      <ObjectiveTicker
        :roshan="store.roshan"
        :runes="store.runes"
        :aegis="store.aegis"
        :tick="tick"
        :aegis-holder="aegisHolder"
      />
    </section>

    <!-- Day/night + vision -->
    <section class="shrink-0 border-t border-border/50 pt-1.5 font-mono">
      <div class="flex items-center justify-between">
        <span :class="dayNight.isNight ? 'text-self' : 'text-gold'" class="font-bold">{{ dayNight.label }}</span>
        <span class="text-[0.62rem] text-text-dim">{{ dayNight.meaning }}</span>
      </div>
      <div class="mt-0.5 flex items-center justify-between text-[0.62rem] text-text-dim">
        <span>vision {{ vision.visible }}/{{ vision.total }} ({{ vision.pct }}%)</span>
        <span v-if="vision.wardsActive">wards {{ vision.wardsActive }}<template v-if="vision.nextWardExpiry != null"> · {{ vision.nextWardExpiry }}t</template></span>
        <span v-else>no wards</span>
      </div>
    </section>

    <!-- Enemy threat sheet (the only part that scrolls; readouts above stay pinned) -->
    <section class="min-h-0 flex-1 overflow-y-auto border-t border-border/50 pt-1.5">
      <div class="mb-1 text-[0.6rem] font-bold tracking-wider text-text-dim uppercase">Enemy Threat</div>
      <EnemyThreatSheet :enemies="store.enemyPlayers" :last-seen="store.lastSeen" :tick="tick" />
    </section>
  </div>
</template>
