<script setup lang="ts">
/**
 * One depth layer of a parallax scene. Place several inside a
 * `position: relative` section and give each a different `depth`.
 *
 * Driven by a CSS scroll-driven animation, so the browser runs it off the main
 * thread and there is no scroll listener, no rAF loop and no layout read.
 *
 * TIMELINE CHOICE — `view()` rather than `scroll()`. `scroll()` maps progress to
 * the WHOLE document's scroll range, so a section near the top of a long page
 * finishes its entire travel in the first few hundred pixels and then sits
 * still. `view()` maps progress to this element's own pass through the
 * viewport, which is what "background drifts as I scroll past it" actually
 * means. Both are the same feature family and the same caveats apply.
 *
 * GOTCHA the shorthand hides: `animation-timeline` MUST be declared AFTER the
 * `animation` shorthand. The shorthand resets every animation-* longhand it does
 * not name — including the timeline — so declaring it first silently drops it
 * and the layer renders static with no error anywhere.
 *
 * Only `transform` is animated: it composites, so no layout or paint per frame.
 * Deliberately NOT `background-attachment: fixed` — iOS Safari ignores it by
 * design, which is why that classic technique looks broken on half of mobile.
 */
withDefaults(
  defineProps<{
    /**
     * 0 = pinned to the page (no parallax). 1 = full travel. Background layers
     * want a LOWER number than foreground ones: things far away appear to move
     * less, which is the entire illusion.
     */
    depth?: number
    /** Total travel in px across the element's pass through the viewport. */
    distance?: number
  }>(),
  { depth: 0.3, distance: 120 },
)
</script>

<template>
  <div
    class="parallax-layer"
    :style="{ '--parallax-shift': `${depth * distance}px` }"
    v-bind="$attrs"
  >
    <slot />
  </div>
</template>

<style scoped>
.parallax-layer {
  will-change: transform;
}

/* Gate on support so browsers without scroll-driven animations get a plain,
   correctly-positioned layer rather than one stuck at a keyframe offset. */
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .parallax-layer {
      animation: parallax-drift linear both;
      /* MUST stay below the shorthand above — see the component comment. */
      animation-timeline: view();
      animation-range: entry 0% exit 100%;
    }
  }
}

@keyframes parallax-drift {
  from {
    transform: translate3d(0, var(--parallax-shift), 0);
  }
  to {
    transform: translate3d(0, calc(var(--parallax-shift) * -1), 0);
  }
}

/* Parallax is a documented vestibular trigger (WCAG 2.3.3). With reduced motion
   the layer is simply static content in normal flow — nothing is hidden, the
   page just scrolls the ordinary way. */
@media (prefers-reduced-motion: reduce) {
  .parallax-layer {
    animation: none;
    transform: none;
    will-change: auto;
  }
}
</style>
