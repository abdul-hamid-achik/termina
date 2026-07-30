<script setup lang="ts">
import HeroLoreCard from './HeroLoreCard.vue'
import { HEROES } from '~~/shared/constants/heroes'
import { CAST } from '~~/shared/constants/cast'
import { heroPlaystyleTags } from '~~/shared/heroPlaystyle'

type HeroId = keyof typeof CAST

// One card per posture so the story shows every grouping.
const ids: HeroId[] = ['echo', 'regex', 'daemon', 'kernel', 'cron', 'socket']
const sample = Object.values(HEROES).filter((h) => ids.includes(h.id as HeroId))
</script>

<template>
  <Story title="Lore/HeroLoreCard" :layout="{ type: 'grid', width: 320 }">
    <Variant
      v-for="h in sample"
      :key="h.id"
      :title="`${CAST[h.id as HeroId].realName} (${h.posture})`"
    >
      <HeroLoreCard
        :hero="h"
        :real-name="CAST[h.id as HeroId].realName"
        :origin="CAST[h.id as HeroId].origin"
        :bio="CAST[h.id as HeroId].bio"
        :handle-rationale="CAST[h.id as HeroId].handleRationale"
        :tags="heroPlaystyleTags(h)"
      />
    </Variant>
  </Story>
</template>
