<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '~/stores/game'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { computeThreat, threatToneClass, recommendAction } from '~/utils/tactics'

// Direction B of the HUD-settings system: an at-a-glance "what do I do now"
// banner. Reuses the same computeThreat() the ZonePanel uses, so the verdict
// can't drift. Gated in GameScreen by settings.hud.focusBanner.
const store = useGameStore()

const player = computed(() => store.player)

const zoneName = computed(() => {
  const z = player.value?.zone
  if (!z) return '—'
  return ZONE_MAP[z]?.name ?? z
})

const threat = computed(() =>
  // Tower nuance is the ZonePanel's job; the banner verdict is hero-vs-hero.
  computeThreat(store.nearbyEnemies.length, store.nearbyAllies.length + 1, false),
)

const threatClass = computed(() => threatToneClass(threat.value.tone))

const toneBg = computed(() => {
  switch (threat.value.tone) {
    case 'danger':
      return 'border-dire/50 bg-dire/10'
    case 'warn':
      return 'border-gold/40 bg-gold/5'
    default:
      return 'border-radiant/40 bg-radiant/5'
  }
})

const hpFraction = computed(() => {
  const p = player.value
  if (!p || p.maxHp <= 0) return 1
  return p.hp / p.maxHp
})

const readyAbilities = computed(() => {
  const p = player.value
  if (!p) return []
  return (['q', 'w', 'e', 'r'] as const).filter((k) => (p.cooldowns?.[k] ?? 0) <= 0)
})

// When nothing is ready, surface the soonest ability + its remaining cooldown
// ("next Q 2t") so the banner answers "when can I act?", not just "nothing now".
const nextAbility = computed<{ key: string; cd: number } | null>(() => {
  const p = player.value
  if (!p) return null
  let best: { key: string; cd: number } | null = null
  for (const k of ['q', 'w', 'e', 'r'] as const) {
    const cd = p.cooldowns?.[k] ?? 0
    if (cd > 0 && (best === null || cd < best.cd)) best = { key: k, cd }
  }
  return best
})

const recommendation = computed(() =>
  recommendAction({
    alive: store.isAlive,
    hpFraction: hpFraction.value,
    threat: threat.value,
    hasReadyAbility: readyAbilities.value.length > 0,
  }),
)
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 font-mono text-[0.8rem]"
    :class="toneBg"
    data-testid="focus-banner"
  >
    <!-- Threat verdict -->
    <span
      class="shrink-0 text-[0.92rem] font-bold tracking-wider text-glow-sm"
      :class="threatClass"
      data-testid="focus-threat"
      >{{ threat.label }}</span
    >

    <span class="shrink-0 text-text-dim">@ {{ zoneName }}</span>

    <!-- Recommendation -->
    <span class="min-w-0 flex-1 truncate text-text-primary" data-testid="focus-recommendation"
      >▸ {{ recommendation }}</span
    >

    <!-- Ready abilities -->
    <span class="flex shrink-0 items-center gap-1" data-testid="focus-ready">
      <span class="text-[0.66rem] uppercase tracking-wider text-text-dim">ready</span>
      <template v-if="readyAbilities.length">
        <span
          v-for="k in readyAbilities"
          :key="k"
          class="border border-ability px-1.5 py-0.5 text-[0.7rem] font-bold text-ability text-glow-sm"
          :data-testid="`focus-ready-${k}`"
          >{{ k.toUpperCase() }}</span
        >
      </template>
      <span
        v-else-if="nextAbility"
        class="text-[0.7rem] text-text-dim"
        data-testid="focus-ready-next"
      >
        next <span class="font-bold text-warn">{{ nextAbility.key.toUpperCase() }}</span>
        {{ nextAbility.cd }}t
      </span>
      <span v-else class="text-[0.7rem] text-text-dim" data-testid="focus-ready-none">—</span>
    </span>
  </div>
</template>
