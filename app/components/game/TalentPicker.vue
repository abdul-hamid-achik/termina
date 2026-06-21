<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerState } from '~~/shared/types/game'
import { getTalentTree, type TalentTier } from '~~/shared/constants/talents'

const props = defineProps<{ player: PlayerState | null }>()
const emit = defineEmits<{ pick: [tier: TalentTier, side: 'left' | 'right'] }>()

const TIERS: TalentTier[] = [10, 15, 20, 25]

/**
 * The lowest tier the player has reached but not yet chosen a talent for.
 * Drives the prompt's visibility — it appears the tick a talent unlocks and
 * vanishes once the choice lands in `player.talents` on the next tick_state.
 */
const pending = computed(() => {
  const p = props.player
  // No alive check — talents can be chosen while dead (server allows it).
  if (!p?.heroId) return null
  const tree = getTalentTree(p.heroId)
  if (!tree) return null
  for (const tier of TIERS) {
    if (p.level >= tier && !p.talents[`tier${tier}` as const]) {
      return { tier, left: tree.tiers[tier][0], right: tree.tiers[tier][1] }
    }
  }
  return null
})
</script>

<template>
  <div
    v-if="pending"
    data-testid="talent-picker"
    class="anim-fade-in-up mb-1 rounded border border-gold bg-bg-panel/95 p-2 text-[0.72rem] bloom-gold"
  >
    <div class="mb-1 flex items-center gap-2 font-mono text-gold text-glow-gold">
      <span class="anim-glow-pulse">★</span>
      <span>LEVEL {{ pending.tier }} TALENT — choose one</span>
    </div>
    <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
      <button
        v-for="side in ['left', 'right'] as const"
        :key="side"
        :data-testid="`talent-pick-${side}`"
        class="rounded border border-border bg-bg-secondary px-2 py-1 text-left transition-colors hover:border-gold hover:bg-bg-tertiary"
        @click="emit('pick', pending.tier, side)"
      >
        <div class="font-mono text-radiant">{{ pending[side].name }}</div>
        <div class="text-text-dim">{{ pending[side].description }}</div>
      </button>
    </div>
  </div>
</template>
