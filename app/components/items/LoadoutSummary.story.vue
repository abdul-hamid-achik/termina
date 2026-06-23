<script setup lang="ts">
import LoadoutSummary from './LoadoutSummary.vue'
import { ITEMS } from '~~/shared/constants/items'

const empty: never[] = []
const partial = [ITEMS.vanguard!, ITEMS.dagon!]
const full = [
  ITEMS.daedalus!,
  ITEMS.black_king_bar!,
  ITEMS.heart_of_tarrasque!,
  ITEMS.scythe_of_vyse!,
  ITEMS.silver_edge!,
  ITEMS.assault_cuirass!,
]
</script>

<template>
  <Story title="Items/LoadoutSummary" :layout="{ type: 'grid', width: 280 }">
    <Variant title="Empty">
      <LoadoutSummary :items="empty" :max-slots="6" />
    </Variant>
    <Variant title="Partial (2)">
      <LoadoutSummary :items="partial" :max-slots="6" />
    </Variant>
    <Variant title="Full build (6)">
      <LoadoutSummary :items="full" :max-slots="6" />
    </Variant>
  </Story>
</template>
