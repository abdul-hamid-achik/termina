<script setup lang="ts">
import LoadoutSummary from './LoadoutSummary.vue'
import { ITEMS } from '~~/shared/constants/items'

const empty: never[] = []
const partial = [ITEMS.bulwark_plate!, ITEMS.dagon!]
const full = [
  ITEMS.killshot_coil!,
  ITEMS.hardshell!,
  ITEMS.bulk_lattice!,
  ITEMS.scythe_of_vyse!,
  ITEMS.ghostwire_edge!,
  ITEMS.siege_lattice!,
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
