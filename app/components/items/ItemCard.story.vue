<script setup lang="ts">
import ItemCard from './ItemCard.vue'
import { ITEMS } from '~~/shared/constants/items'

// One item per shape so the story shows every rendering branch.
const statItem = ITEMS.bulwark_plate! // stats + passive
const activeItem = ITEMS.burnout! // stats + targeted active (cd/bw/target)
const consumable = ITEMS.camtap! // consumable + zone active, no stats
const richest = ITEMS.last_word! // big stats + passive, expensive
</script>

<template>
  <Story title="Items/ItemCard" :layout="{ type: 'grid', width: 320 }">
    <Variant title="Stats + passive">
      <ItemCard :item="statItem" />
    </Variant>
    <Variant title="Active (cd/bw/target)">
      <ItemCard :item="activeItem" />
    </Variant>
    <Variant title="Consumable">
      <ItemCard :item="consumable" />
    </Variant>
    <Variant title="Interactive (unselected)">
      <ItemCard :item="richest" interactive />
    </Variant>
    <Variant title="Selected (in loadout)">
      <ItemCard :item="richest" interactive selected />
    </Variant>
  </Story>
</template>
