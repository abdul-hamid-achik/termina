<script setup lang="ts">
import { SAMPLE_HEROES, SAMPLE_HERO_ID } from '~/stories/fixtures'
import HeroAvatar from './HeroAvatar.vue'

// Every hero id in SAMPLE_HEROES has a pixelData grid, so the gallery renders
// real sprites. Object.values gives the id strings the component expects.
const heroIds = Object.values(SAMPLE_HEROES)
</script>

<!--
  Pure props-driven pixel-art sprite (canvas, drawn from heroPixelData). Covers a
  single default render, the `size` prop across a range, an unknown id (canvas
  stays blank but the bordered frame still shows), and a gallery of every sample
  hero so palettes/grids are eyeballable.
-->
<template>
  <Story title="Game/HeroAvatar" :layout="{ type: 'grid', width: 200 }">
    <Variant title="default (echo, 48px)">
      <div class="bg-bg-primary p-3">
        <HeroAvatar :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="size — 24px">
      <div class="bg-bg-primary p-3">
        <HeroAvatar :hero-id="SAMPLE_HEROES.daemon" :size="24" />
      </div>
    </Variant>
    <Variant title="size — 48px">
      <div class="bg-bg-primary p-3">
        <HeroAvatar :hero-id="SAMPLE_HEROES.kernel" :size="48" />
      </div>
    </Variant>
    <Variant title="size — 96px">
      <div class="bg-bg-primary p-3">
        <HeroAvatar :hero-id="SAMPLE_HEROES.regex" :size="96" />
      </div>
    </Variant>

    <Variant title="unknown hero id (blank canvas)">
      <div class="bg-bg-primary p-3">
        <HeroAvatar hero-id="does_not_exist" :size="48" />
      </div>
    </Variant>

    <Variant title="all sample heroes">
      <div class="flex flex-wrap items-end gap-2 bg-bg-primary p-3">
        <div v-for="id in heroIds" :key="id" class="flex flex-col items-center gap-1">
          <HeroAvatar :hero-id="id" :size="48" />
          <span class="font-mono text-[0.6rem] text-text-dim">{{ id }}</span>
        </div>
      </div>
    </Variant>
  </Story>
</template>
