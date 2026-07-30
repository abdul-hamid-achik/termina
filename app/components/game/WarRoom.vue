<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '~/stores/game'
import { HEROES } from '~~/shared/constants/heroes'
import { goldLead, formatGoldShort, visionSummary, dayNightReadout } from '~/utils/strategy'
import ObjectiveTicker from '~/components/game/ObjectiveTicker.vue'
import EnemyThreatSheet from '~/components/game/EnemyThreatSheet.vue'
import AllyStatusSheet from '~/components/game/AllyStatusSheet.vue'
import Sparkline from '~/components/game/Sparkline.vue'

/**
 * Store-connected War Room container — the strategic dashboard that surfaces
 * everything a text MOBA can uniquely show: net-worth lead + trend, the
 * objective layer (Tenant/caches/backup), the enemy threat sheet (cooldowns,
 * respawns, last-seen), day/night meaning and vision coverage. Leaf panels are
 * pure/prop-based; this wires the store into them.
 */
const store = useGameStore()

const tick = computed(() => store.tick)

// The backup carrier is whoever holds the 'backup' buff (the engine clears the
// ground backup to null on pickup), resolved to a readable name + countdown.
const backupHolder = computed(() => {
  for (const p of Object.values(store.allPlayers)) {
    const buff = (p.buffs ?? []).find((b) => b.id === 'backup')
    if (buff) {
      const name = (p.heroId && HEROES[p.heroId]?.name) || p.name
      return { name, ticksRemaining: buff.ticksRemaining }
    }
  }
  return null
})

// Net-worth lead + trend (lead series = chaff - audit over recent ticks).
const lead = computed(() => goldLead(store.netWorth.chaff, store.netWorth.audit))
const leadSeries = computed(() => {
  const r = store.netWorthHistory.chaff
  const d = store.netWorthHistory.audit
  const n = Math.min(r.length, d.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((r[i] ?? 0) - (d[i] ?? 0))
  return out
})
const leadColorVar = computed(() =>
  lead.value.leader === 'chaff'
    ? 'color-chaff'
    : lead.value.leader === 'audit'
      ? 'color-audit'
      : 'text-dim',
)

// Vision coverage + ward expiry (own-team wards in currently-visible zones).
const vision = computed(() => {
  const myTeam = store.player?.team
  const wards = Object.values(store.visibleZones)
    .flatMap((z) => z.wards ?? [])
    .filter((w) => !myTeam || w.team === myTeam)
  return visionSummary(store.visibleZoneIds, wards, store.tick)
})

const dayNight = computed(() => dayNightReadout(store.timeOfDay))
</script>

<template>
  <div data-testid="war-room" class="flex h-full min-h-0 flex-col gap-2 p-1 t-hud-sm">
    <!-- Net worth lead + trend -->
    <section class="shrink-0">
      <div class="mb-0.5 flex items-center justify-between">
        <span class="t-hud-xs font-bold tracking-wider text-text-dim uppercase">Net Worth</span>
        <Sparkline :values="leadSeries" :color-var="leadColorVar" class="t-hud-sm" />
      </div>
      <div class="flex items-baseline gap-1 font-mono">
        <span
          v-if="lead.leader"
          :class="lead.leader === 'chaff' ? 'text-chaff' : 'text-audit'"
          class="font-bold"
        >
          {{ lead.leader === 'chaff' ? 'RAD' : 'AUDIT' }} +{{ formatGoldShort(lead.amount) }}
        </span>
        <span v-else class="text-text-dim">even</span>
      </div>
    </section>

    <!-- Objectives -->
    <section class="shrink-0 border-t border-border/50 pt-1.5">
      <div class="mb-0.5 t-hud-xs font-bold tracking-wider text-text-dim uppercase">Objectives</div>
      <ObjectiveTicker
        :tenant="store.tenant"
        :caches="store.caches"
        :backup="store.backup"
        :tick="tick"
        :backup-holder="backupHolder"
      />
    </section>

    <!-- Day/night + vision -->
    <section class="shrink-0 border-t border-border/50 pt-1.5 font-mono">
      <div class="flex items-center justify-between">
        <span :class="dayNight.isNight ? 'text-self' : 'text-gold'" class="font-bold">{{
          dayNight.label
        }}</span>
        <span class="t-hud-xs text-text-dim">{{ dayNight.meaning }}</span>
      </div>
      <div class="mt-0.5 flex items-center justify-between t-hud-xs text-text-dim">
        <span>vision {{ vision.visible }}/{{ vision.total }} ({{ vision.pct }}%)</span>
        <span v-if="vision.wardsActive"
          >wards {{ vision.wardsActive
          }}<template v-if="vision.nextWardExpiry != null">
            · {{ vision.nextWardExpiry }}c</template
          ></span
        >
        <span v-else>no wards</span>
      </div>
    </section>

    <!-- Enemy threat is always on: enemy cooldowns/respawn/last-seen is the one
         readout a text MOBA shows better than a graphical one, so it must not
         start hidden behind a toggle. The ally roster is always expanded too —
         the roster toggle died with the HUD preset system (R3-10). -->
    <section
      data-testid="war-room-enemy-threat"
      class="flex min-h-0 flex-1 flex-col border-t border-border/50 pt-1.5"
    >
      <div class="mb-1 shrink-0 t-hud-xs font-bold tracking-wider text-text-dim uppercase">
        Enemy Threat
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <EnemyThreatSheet :enemies="store.enemyPlayers" :last-seen="store.lastSeen" :tick="tick" />
      </div>
    </section>

    <section
      data-testid="war-room-roster"
      class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto border-t border-border/50 pt-1.5"
    >
      <div class="t-hud-xs font-bold tracking-wider text-text-dim uppercase">Allies</div>
      <AllyStatusSheet :allies="store.allyPlayers" :tick="tick" />
    </section>
  </div>
</template>
