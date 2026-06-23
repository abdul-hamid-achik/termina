<script setup lang="ts">
import { computed } from 'vue'
import type { ItemDef } from '~~/shared/types/items'
import { aggregateStats, totalCost, formatStats } from '~~/shared/itemFormat'

const props = defineProps<{
  items: ItemDef[]
  /** Inventory size (the dummy build can hold this many). */
  maxSlots: number
}>()

const emit = defineEmits<{ clear: [] }>()

const cost = computed(() => totalCost(props.items))
const statLines = computed(() => formatStats(aggregateStats(props.items)))
// Items that bring an activated ability — what this build can *do* in a fight.
const actives = computed(() => props.items.filter((i) => i.active).map((i) => i.active!))
</script>

<template>
  <div
    class="flex flex-col gap-2 border border-border bg-bg-secondary p-2.5"
    data-testid="loadout-summary"
  >
    <div class="flex items-center justify-between text-[0.72rem]">
      <span class="font-bold text-text-primary">Your build</span>
      <span class="text-text-dim" data-testid="loadout-slots"
        >{{ items.length }} / {{ maxSlots }}</span
      >
    </div>

    <div class="flex items-center justify-between text-[0.72rem]">
      <span class="text-text-dim">total cost</span>
      <span class="text-gold" data-testid="loadout-cost">{{ cost }}g</span>
    </div>

    <div v-if="items.length === 0" class="text-[0.66rem] italic text-text-dim">
      Pick items to see the stats, cost and abilities they stack up to.
    </div>

    <template v-else>
      <!-- Aggregated stats -->
      <div v-if="statLines.length" class="flex flex-col gap-0.5">
        <span class="text-[0.6rem] uppercase tracking-wider text-text-dim">combined stats</span>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="(s, i) in statLines"
            :key="i"
            class="border border-border bg-bg-primary px-1 py-0.5 text-[0.65rem] text-radiant"
          >
            {{ s }}
          </span>
        </div>
      </div>

      <!-- Actives this build grants -->
      <div v-if="actives.length" class="flex flex-col gap-0.5">
        <span class="text-[0.6rem] uppercase tracking-wider text-text-dim">actives</span>
        <span v-for="(a, i) in actives" :key="i" class="text-[0.66rem] text-ability">
          {{ a.name }}
        </span>
      </div>

      <button
        type="button"
        class="mt-1 self-start text-[0.62rem] uppercase tracking-wider text-text-dim transition-colors hover:text-dire"
        data-testid="loadout-clear"
        @click="emit('clear')"
      >
        clear build
      </button>
    </template>
  </div>
</template>
