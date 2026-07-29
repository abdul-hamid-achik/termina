<script setup lang="ts">
import ParallaxLayer from './ParallaxLayer.vue'
</script>

<!--
  Depth layer for a parallax scene. Driven by a CSS scroll-driven animation
  (animation-timeline: view()), so it needs REAL SCROLL to show anything — the
  tall spacers below exist for that. In a browser without scroll-driven
  animation support the layers simply sit still, which is the intended fallback,
  and prefers-reduced-motion disables them outright.

  Depth is the whole illusion: a lower number moves less, reading as further
  away. The three-layer variant is the arrangement the landing page uses.
-->
<template>
  <Story title="UI/ParallaxLayer" :layout="{ type: 'single', iframe: true }">
    <Variant title="three-layer scene (scroll me)">
      <div class="font-mono text-xs text-text-dim">
        <div class="flex h-[60vh] items-center justify-center border border-dashed border-border">
          scroll down ↓
        </div>

        <section class="relative flex h-[80vh] items-center justify-center overflow-hidden">
          <ParallaxLayer :depth="0.15" class="pointer-events-none absolute inset-0 -z-10">
            <div class="grid h-full w-full grid-cols-8 place-items-center text-radiant/20">
              <span v-for="i in 64" :key="i">{{ ['0', '1', '·', '│'][i % 4] }}</span>
            </div>
          </ParallaxLayer>

          <ParallaxLayer :depth="0.35">
            <p class="text-2xl text-radiant">MID — depth 0.35</p>
          </ParallaxLayer>

          <ParallaxLayer :depth="0.6" class="absolute bottom-8">
            <p class="text-ability">FRONT — depth 0.6 (travels most)</p>
          </ParallaxLayer>
        </section>

        <div class="flex h-[60vh] items-center justify-center border border-dashed border-border">
          ↑ scroll back
        </div>
      </div>
    </Variant>

    <Variant title="depth comparison">
      <div class="font-mono text-xs">
        <div class="h-[60vh]" />
        <section class="relative flex h-[80vh] flex-col justify-around overflow-hidden">
          <ParallaxLayer v-for="d in [0, 0.2, 0.4, 0.8]" :key="d" :depth="d">
            <p class="text-text-dim">depth {{ d }}{{ d === 0 ? ' — pinned, no parallax' : '' }}</p>
          </ParallaxLayer>
        </section>
        <div class="h-[60vh]" />
      </div>
    </Variant>
  </Story>
</template>
