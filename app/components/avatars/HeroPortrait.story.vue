<script setup lang="ts">
import HeroPortrait from './HeroPortrait.vue'
</script>

<template>
  <Story title="Avatars/HeroPortrait" :layout="{ type: 'grid', width: 220 }">
    <Variant title="32px">
      <HeroPortrait hero-id="echo" :size="32" />
    </Variant>
    <Variant title="48px (default)">
      <HeroPortrait hero-id="daemon" :size="48" />
    </Variant>
    <Variant title="96px (512 asset)">
      <HeroPortrait hero-id="kernel" :size="96" />
    </Variant>
    <Variant title="512px (detail panel)">
      <HeroPortrait hero-id="sentry" :size="512" />
    </Variant>
    <Variant title="unknown hero (glyph fallback on error)">
      <HeroPortrait hero-id="ghost_99" :size="48" />
    </Variant>
  </Story>
</template>
