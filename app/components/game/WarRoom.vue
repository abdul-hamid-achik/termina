<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '~/stores/game'
import { useSettingsStore } from '~/stores/settings'
import { HEROES } from '~~/shared/constants/heroes'
import { goldLead, formatGoldShort, visionSummary, dayNightReadout } from '~/utils/strategy'
import ObjectiveTicker from '~/components/game/ObjectiveTicker.vue'
import EnemyThreatSheet from '~/components/game/EnemyThreatSheet.vue'
import AllyStatusSheet from '~/components/game/AllyStatusSheet.vue'
import Sparkline from '~/components/game/Sparkline.vue'

/**
 * Store-connected War Room container — the strategic dashboard that surfaces
 * everything a text MOBA can uniquely show: net-worth lead + trend, the
 * objective layer (Roshan/runes/aegis), the enemy threat sheet (cooldowns,
 * respawns, last-seen), day/night meaning and vision coverage. Leaf panels are
 * pure/prop-based; this wires the store into them.
 */
const store = useGameStore()
const settings = useSettingsStore()

const tick = computed(() => store.tick)

// The ally roster is a HUD setting (collapsed on the simplified default
// preset; the enemy threat sheet is unconditional). Toggling goes through
// setHud so hudPreset re-derives to 'custom' when the player diverges from a
// named preset — and the choice persists.
const rosterExpanded = computed(() => settings.hud.rosterExpanded)
function toggleRoster() {
  settings.setHud('rosterExpanded', !settings.hud.rosterExpanded)
}

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
  return visionSummary(store.visibleZoneIds, wards, store.tick)
})

const dayNight = computed(() => dayNightReadout(store.timeOfDay))
</script>

<template>
  <div data-testid="war-room" class="flex h-full min-h-0 flex-col gap-2 p-1 text-[0.72rem]">
    <!-- Net worth lead + trend -->
    <section class="shrink-0">
      <div class="mb-0.5 flex items-center justify-between">
        <span class="text-[0.6rem] font-bold tracking-wider text-text-dim uppercase"
          >Net Worth</span
        >
        <Sparkline :values="leadSeries" :color-var="leadColorVar" class="text-[0.7rem]" />
      </div>
      <div class="flex items-baseline gap-1 font-mono">
        <span
          v-if="lead.leader"
          :class="lead.leader === 'radiant' ? 'text-radiant' : 'text-dire'"
          class="font-bold"
        >
          {{ lead.leader === 'radiant' ? 'RAD' : 'DIRE' }} +{{ formatGoldShort(lead.amount) }}
        </span>
        <span v-else class="text-text-dim">even</span>
      </div>
    </section>

    <!-- Objectives -->
    <section class="shrink-0 border-t border-border/50 pt-1.5">
      <div class="mb-0.5 text-[0.6rem] font-bold tracking-wider text-text-dim uppercase">
        Objectives
      </div>
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
        <span :class="dayNight.isNight ? 'text-self' : 'text-gold'" class="font-bold">{{
          dayNight.label
        }}</span>
        <span class="text-[0.62rem] text-text-dim">{{ dayNight.meaning }}</span>
      </div>
      <div class="mt-0.5 flex items-center justify-between text-[0.62rem] text-text-dim">
        <span>vision {{ vision.visible }}/{{ vision.total }} ({{ vision.pct }}%)</span>
        <span v-if="vision.wardsActive"
          >wards {{ vision.wardsActive
          }}<template v-if="vision.nextWardExpiry != null">
            · {{ vision.nextWardExpiry }}t</template
          ></span
        >
        <span v-else>no wards</span>
      </div>
    </section>

    <!-- Enemy threat is always on: enemy cooldowns/respawn/last-seen is the one
         readout a text MOBA shows better than a graphical one, so it must not
         start hidden behind a toggle. Only the ally roster stays collapsible
         behind the rosterExpanded HUD setting (collapsed on the simplified
         default preset) — the readouts above it stay pinned. -->
    <section
      data-testid="war-room-enemy-threat"
      class="flex min-h-0 flex-1 flex-col border-t border-border/50 pt-1.5"
    >
      <div class="mb-1 shrink-0 text-[0.6rem] font-bold tracking-wider text-text-dim uppercase">
        Enemy Threat
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <EnemyThreatSheet :enemies="store.enemyPlayers" :last-seen="store.lastSeen" :tick="tick" />
      </div>
    </section>

    <button
      v-if="!rosterExpanded"
      type="button"
      data-testid="war-room-roster-toggle"
      aria-expanded="false"
      class="min-h-[2rem] w-full shrink-0 border-t border-border/50 pt-1.5 text-left text-[0.6rem] font-bold tracking-wider text-text-dim uppercase transition-colors hover:text-text-primary"
      @click="toggleRoster"
    >
      [+] Allies
    </button>
    <section
      v-else
      data-testid="war-room-roster"
      class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto border-t border-border/50 pt-1.5"
    >
      <button
        type="button"
        data-testid="war-room-roster-toggle"
        aria-expanded="true"
        class="min-h-[2rem] w-full shrink-0 text-left text-[0.6rem] font-bold tracking-wider text-text-dim uppercase transition-colors hover:text-text-primary"
        @click="toggleRoster"
      >
        [−] Allies
      </button>
      <AllyStatusSheet :allies="store.allyPlayers" :tick="tick" />
    </section>
  </div>
</template>
