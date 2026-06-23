<script setup lang="ts">
import { computed } from 'vue'
import { ITEMS } from '~~/shared/constants/items'
import type { ItemDef } from '~~/shared/types/items'

const props = defineProps<{
  pinnedItems: string[]
  gold: number
  canBuy: boolean
  /** Role recommendations, shown as a fallback when nothing is pinned. */
  recommendedItems?: string[]
}>()

const emit = defineEmits<{
  buy: [itemId: string]
  unpin: [itemId: string]
}>()

interface PinnedEntry {
  id: string
  def: ItemDef
  affordable: boolean
  goldNeeded: number
}

// When nothing is pinned, fall back to the first few role recommendations so the
// quick-buy bar still guides a new player. Suggestions aren't pinned, so they
// show no unpin control.
const usingSuggestions = computed(
  () => props.pinnedItems.length === 0 && (props.recommendedItems?.length ?? 0) > 0,
)

const entries = computed<PinnedEntry[]>(() => {
  const ids = usingSuggestions.value
    ? (props.recommendedItems ?? []).slice(0, 4)
    : props.pinnedItems
  return ids
    .map((id) => {
      const def = ITEMS[id]
      if (!def) return null
      const goldNeeded = Math.max(0, def.cost - props.gold)
      return { id, def, affordable: props.gold >= def.cost, goldNeeded }
    })
    .filter((e): e is PinnedEntry => e !== null)
})
</script>

<template>
  <div v-if="entries.length" class="flex flex-col gap-0.5">
    <span class="text-[0.6rem] uppercase tracking-wide text-text-dim">{{
      usingSuggestions ? 'Suggested' : 'Quick Buy'
    }}</span>
    <div class="flex flex-wrap gap-1">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="touch-gap flex items-center gap-1 border px-1.5 py-0.5 text-[0.65rem]"
        :class="[
          entry.affordable && canBuy
            ? 'border-gold cursor-pointer text-text-primary hover:bg-gold/10'
            : 'border-border text-text-dim',
        ]"
        :data-testid="`quickbuy-${entry.id}`"
      >
        <span class="font-bold">{{ entry.def.name }}</span>
        <span v-if="entry.affordable" class="text-gold">{{ entry.def.cost }}g</span>
        <span v-else class="text-dire">-{{ entry.goldNeeded }}g</span>
        <button
          v-if="entry.affordable && canBuy"
          class="touch-target text-radiant hover:underline"
          :data-testid="`quickbuy-buy-${entry.id}`"
          :aria-label="`Buy ${entry.def.name} for ${entry.def.cost} gold`"
          @click="emit('buy', entry.id)"
        >
          [BUY]
        </button>
        <!-- Destructive unpin sits behind the coarse-pointer touch gap so a
             missed [BUY] tap can't land on it. Hidden for suggestions (not pinned). -->
        <button
          v-if="!usingSuggestions"
          class="touch-target text-text-dim hover:text-dire"
          :data-testid="`quickbuy-unpin-${entry.id}`"
          :aria-label="`Unpin ${entry.def.name}`"
          @click="emit('unpin', entry.id)"
        >
          x
        </button>
      </div>
    </div>
  </div>
</template>
