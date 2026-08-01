<script setup lang="ts">
import ScrambleText from '~/components/ui/ScrambleText.vue'

/**
 * One beat of the lore page.
 *
 * The page used to be six paragraphs in a row. The prose was good and read as a
 * wall — nothing told you where one idea ended and the next began, so the eye
 * had no purchase and the whole thing arrived as texture rather than as a world.
 *
 * A beat gives each idea a number, a decoding heading, and its own column, which
 * is enough structure to make the page scannable without adding chrome that a
 * terminal would not have. The number is the point: it says "there are a
 * countable number of things you need to know", which is the opposite of a wall.
 */
defineProps<{
  /** Zero-padded index, rendered as the beat's marker. */
  index: string
  title: string
  /** Anchor id, so the section nav can jump here. */
  id: string
}>()
</script>

<template>
  <section :id="id" class="scroll-mt-20 flex flex-col gap-3">
    <header class="flex items-baseline gap-3 border-b border-border pb-1.5">
      <span class="t-mono-num shrink-0 text-[0.7rem] text-text-muted">[{{ index }}]</span>
      <h2 class="text-[0.95rem] font-bold tracking-widest text-chaff">
        <ScrambleText :text="title" :speed="380" />
      </h2>
    </header>
    <div class="flex flex-col gap-3 pl-[2.4rem] text-[0.84rem] leading-relaxed text-text-dim">
      <slot />
    </div>
  </section>
</template>
