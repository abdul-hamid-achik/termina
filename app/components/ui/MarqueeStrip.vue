<script setup lang="ts">
/**
 * Auto-scrolling ticker.
 *
 * The content is rendered EXACTLY TWICE and the track translates by -50%, so the
 * second copy is flush against the first at the moment the animation wraps —
 * that is what makes the loop seamless. Any other duplication factor (or any
 * width that is not a clean multiple) produces a visible jump.
 *
 * Not `<marquee>`: that element is deprecated, unstylable, and offers no way to
 * pause. Everything here is a CSS transform, so it stays off the main thread.
 *
 * The strip is `aria-hidden`: it is an ambience device repeating content that
 * already exists elsewhere on the page, and its DOM is duplicated — a screen
 * reader announcing every item twice would be pure noise.
 */
withDefaults(
  defineProps<{
    items: string[]
    /** Seconds for one full pass. Longer strips want a longer duration. */
    duration?: number
    /** Scroll direction — a second strip running the other way reads as depth. */
    reverse?: boolean
    separator?: string
  }>(),
  { duration: 40, reverse: false, separator: '·' },
)
</script>

<template>
  <div
    aria-hidden="true"
    class="marquee relative w-full overflow-hidden border-y border-border/60 bg-bg-secondary/40 py-2 select-none"
  >
    <div
      class="marquee__track flex w-max"
      :class="{ 'marquee__track--reverse': reverse }"
      :style="{ '--marquee-duration': `${duration}s` }"
    >
      <ul v-for="copy in 2" :key="copy" class="flex shrink-0 items-center gap-6 pr-6">
        <li
          v-for="(item, i) in items"
          :key="`${copy}-${i}`"
          class="flex items-center gap-6 font-mono text-[0.72rem] whitespace-nowrap text-text-dim"
        >
          <span>{{ item }}</span>
          <span class="text-ability/50">{{ separator }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* Fade the strip out at both edges so items enter and leave instead of being
   chopped off at a hard border. mask-image is the only property here that is
   not transform/opacity, and it is static — it never animates. */
.marquee {
  mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent);
  -webkit-mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent);
}

.marquee__track {
  animation: marquee-scroll var(--marquee-duration, 40s) linear infinite;
}

.marquee__track--reverse {
  animation-direction: reverse;
}

/* Pausing on hover is what makes the strip readable rather than teasing — the
   player can stop it to actually read a command they want to copy. */
.marquee:hover .marquee__track,
.marquee:focus-within .marquee__track {
  animation-play-state: paused;
}

@keyframes marquee-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .marquee__track {
    animation: none;
  }
  /* With the motion gone the duplicate copy is dead weight that would let the
     strip scroll horizontally; hide it and let the first copy sit still. */
  .marquee__track > ul:nth-child(2) {
    display: none;
  }
}
</style>
