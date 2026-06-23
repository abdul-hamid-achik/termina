<script setup lang="ts">
import { computed } from 'vue'
import type { ItemDef } from '~~/shared/types/items'
import { TICK_DURATION_MS } from '~~/shared/constants/balance'
import { formatStats, activeCooldownSeconds } from '~~/shared/itemFormat'

const props = defineProps<{
  item: ItemDef
  /** Highlight as part of the current loadout. */
  selected?: boolean
  /** Render as a clickable button that emits `toggle`. */
  interactive?: boolean
  /** At-capacity, unselected card: inert + dimmed (the build is full). */
  disabled?: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()

const stats = computed(() => formatStats(props.item.stats))
const cdSeconds = computed(() =>
  props.item.active ? activeCooldownSeconds(props.item.active, TICK_DURATION_MS) : 0,
)
const inert = computed(() => !!props.interactive && !!props.disabled)

function onClick() {
  if (props.interactive && !props.disabled) emit('toggle')
}
</script>

<template>
  <component
    :is="interactive ? 'button' : 'div'"
    :type="interactive ? 'button' : undefined"
    :data-testid="`item-card-${item.id}`"
    :aria-pressed="interactive ? !!selected : undefined"
    :disabled="inert"
    class="flex w-full flex-col gap-1.5 border p-2.5 text-left text-xs transition-colors"
    :class="[
      selected ? 'border-radiant bg-radiant/5' : 'border-border',
      interactive && !inert ? 'cursor-pointer hover:border-border-glow' : '',
      inert ? 'cursor-not-allowed opacity-50' : '',
    ]"
    @click="onClick"
  >
    <!-- Header: name + cost -->
    <div class="flex items-baseline justify-between gap-2">
      <span class="font-bold text-text-primary">{{ item.name }}</span>
      <span class="shrink-0 text-gold">{{ item.cost }}g</span>
    </div>

    <!-- Consumable badge -->
    <div v-if="item.consumable" class="text-[0.6rem] uppercase tracking-wider text-text-dim">
      consumable<span v-if="item.maxStacks"> · stacks ×{{ item.maxStacks }}</span>
    </div>

    <!-- Stats -->
    <div v-if="stats.length" class="flex flex-wrap gap-1">
      <span
        v-for="(s, i) in stats"
        :key="i"
        class="border border-border bg-bg-secondary px-1 py-0.5 text-[0.65rem] text-radiant"
      >
        {{ s }}
      </span>
    </div>

    <!-- Active -->
    <div v-if="item.active" class="text-[0.7rem] leading-snug">
      <span class="text-ability">Active · {{ item.active.name }}</span>
      <span class="text-text-dim"> — {{ item.active.description }}</span>
      <div class="mt-0.5 flex flex-wrap gap-2 text-[0.62rem] text-text-dim">
        <span v-if="cdSeconds > 0"><span class="text-ability">cd</span> {{ cdSeconds }}s</span>
        <span v-if="item.active.manaCost"
          ><span class="text-ability">mp</span> {{ item.active.manaCost }}</span
        >
        <span v-if="item.active.targetType" class="uppercase">{{ item.active.targetType }}</span>
      </div>
    </div>

    <!-- Passive -->
    <div v-if="item.passive" class="text-[0.7rem] leading-snug">
      <span class="text-gold">Passive · {{ item.passive.name }}</span>
      <span class="text-text-dim"> — {{ item.passive.description }}</span>
    </div>

    <!-- Loadout marker -->
    <div
      v-if="selected"
      class="text-[0.6rem] font-bold text-radiant"
      data-testid="item-card-selected"
    >
      ✓ in loadout
    </div>
  </component>
</template>
