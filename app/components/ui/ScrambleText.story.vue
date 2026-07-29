<script setup lang="ts">
import { ref } from 'vue'
import ScrambleText from './ScrambleText.vue'

// Replay handle: the effect only runs on mount / text change, so a story needs a
// way to re-trigger it without a full reload.
const nonce = ref(0)
const lines = [
  '>_ where every command is a kill',
  'A 5v5 MOBA of pure strategy.',
  'tick 42 · Resonance hits Daemon',
]
</script>

<!--
  Decode effect. The churning span is aria-hidden and the real string is exposed
  once via aria-label, so assistive tech never reads the garbage. Under
  prefers-reduced-motion it renders instantly and starts no frame loop — toggle
  the OS setting to check that variant, it cannot be faked from here.
-->
<template>
  <Story title="UI/ScrambleText" :layout="{ type: 'grid', width: 480 }">
    <Variant title="tagline">
      <ScrambleText :key="nonce" text=">_ where every command is a kill" />
    </Variant>

    <Variant title="speeds">
      <div class="flex flex-col gap-2">
        <ScrambleText :key="`fast-${nonce}`" text="fast — 250ms" :speed="250" />
        <ScrambleText :key="`mid-${nonce}`" text="default — 420ms" />
        <ScrambleText :key="`slow-${nonce}`" text="slow — 1400ms" :speed="1400" />
      </div>
    </Variant>

    <Variant title="cascade (staggered delays)">
      <div class="flex flex-col gap-2">
        <ScrambleText
          v-for="(line, i) in lines"
          :key="`${i}-${nonce}`"
          :text="line"
          :speed="900"
          :delay="i * 300"
        />
      </div>
    </Variant>

    <Variant title="width stability">
      <!-- The invisible sizer holds the final width from frame one, so nothing
           below a settling line shifts. The border makes that visible. -->
      <div class="inline-block border border-dashed border-ability p-1">
        <ScrambleText :key="`w-${nonce}`" text="██ width never jitters ██" :speed="1600" />
      </div>
    </Variant>

    <template #controls>
      <button class="border border-border px-2 py-1 font-mono text-xs" @click="nonce++">
        replay
      </button>
    </template>
  </Story>
</template>
