<script setup lang="ts">
import MarqueeStrip from './MarqueeStrip.vue'

const commands = [
  'move mid-river',
  'attack creep:0',
  'cast q hero:daemon',
  'buy blades_of_attack',
  'ward mid-river',
  'attack roshan',
]
const short = ['alpha', 'beta', 'gamma']
</script>

<!--
  Auto-scrolling ticker. Content is duplicated EXACTLY twice and the track moves
  -50%, which is what makes the wrap seamless — changing either would show a
  jump. Hover to pause (animation-play-state), and note the edge fade masks.
  Under prefers-reduced-motion the motion stops and the duplicate copy is hidden.
-->
<template>
  <Story title="UI/MarqueeStrip" :layout="{ type: 'grid', width: 640 }">
    <Variant title="commands">
      <MarqueeStrip :items="commands" />
    </Variant>

    <Variant title="reverse">
      <MarqueeStrip :items="commands" reverse />
    </Variant>

    <Variant title="counter-running pair (reads as two planes)">
      <div class="flex flex-col gap-2">
        <MarqueeStrip :items="commands" :duration="35" />
        <MarqueeStrip :items="commands" :duration="45" reverse />
      </div>
    </Variant>

    <Variant title="fast">
      <MarqueeStrip :items="commands" :duration="8" />
    </Variant>

    <Variant title="few items (still has to fill the strip)">
      <MarqueeStrip :items="short" :duration="12" />
    </Variant>

    <Variant title="custom separator">
      <MarqueeStrip :items="short" separator="//" :duration="14" />
    </Variant>
  </Story>
</template>
