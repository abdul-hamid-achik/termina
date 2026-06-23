<script setup lang="ts">
import HeroLoreCard from './HeroLoreCard.vue'
import { HEROES } from '~~/shared/constants/heroes'
import { heroPlaystyleTags } from '~~/shared/heroPlaystyle'

// One card per role so the story shows every colour variant.
const ids = ['echo', 'regex', 'daemon', 'kernel', 'cron', 'socket']
const sample = Object.values(HEROES).filter((h) => ids.includes(h.id))
</script>

<template>
  <Story title="Lore/HeroLoreCard" :layout="{ type: 'grid', width: 320 }">
    <Variant v-for="h in sample" :key="h.id" :title="`${h.name} (${h.role})`">
      <HeroLoreCard :hero="h" :tags="heroPlaystyleTags(h)" />
    </Variant>
  </Story>
</template>
