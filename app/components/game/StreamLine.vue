<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

/**
 * One line of the feed, decoding as it arrives.
 *
 * The stream is the surface a player reads every four seconds, and text simply
 * appearing in it gives no sense that anything was *received*. A short decode —
 * glyphs churning into the real characters, left to right — makes each line
 * read as a transmission landing, which is what the fiction says it is.
 *
 * Four constraints, all of which the naive version gets wrong:
 *
 * 1. **Only NEW lines decode.** This animates on mount and never again, so a
 *    line that is already on screen stays put when the next cycle arrives.
 *    Re-scrambling history every cycle would make the log unreadable.
 * 2. **It never delays comprehension.** The decode is ~180ms and only the tail
 *    of the string is ever scrambled — the first characters are legible
 *    immediately, so a player skimming for "who hit me" is not made to wait.
 * 3. **The DOM always holds the REAL text.** The churn is a separate
 *    aria-hidden layer over an already-correct string, so a screen reader, a
 *    text search and the e2e suite all see the final line from frame one. The
 *    landing page's ScrambleText had to grow a visually-hidden copy for exactly
 *    this reason; here the real text is simply never replaced.
 * 4. **Reduced motion means no animation at all** — not a faster one.
 */
const props = withDefaults(defineProps<{ text: string; duration?: number }>(), { duration: 180 })

/** Box-drawing and operator glyphs — same set the landing decode uses, so the
 *  two effects read as one machine rather than two. */
const GLYPHS = '01<>[]{}/\\|=+*#%$&@~^:;·─│╱╲'

/** Longest tail we will ever scramble. A whole long line churning is noise; the
 *  effect only has to suggest arrival, not obscure the message. */
const MAX_TAIL = 14

const overlay = ref('')
const running = ref(false)
let raf: number | null = null

function stop() {
  if (raf !== null) cancelAnimationFrame(raf)
  raf = null
  running.value = false
  overlay.value = ''
}

onMounted(() => {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  if (reduced || !props.text) return

  const text = props.text
  const tail = Math.min(MAX_TAIL, text.length)
  const head = text.length - tail
  if (tail <= 0) return

  running.value = true
  const start = performance.now()

  const tick = (now: number) => {
    const t = (now - start) / props.duration
    if (t >= 1) return stop()
    // Settle left to right: everything before `settled` is already correct.
    const settled = Math.floor(t * tail)
    let out = text.slice(0, head + settled)
    for (let i = head + settled; i < text.length; i++) {
      const ch = text[i]!
      // Whitespace never churns — a moving gap reads as a layout bug.
      out += ch === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
    }
    overlay.value = out
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})

onUnmounted(stop)
</script>

<template>
  <span class="relative inline-block whitespace-pre-wrap">
    <!-- The real text is always here and always correct. -->
    <span :class="{ 'opacity-0': running }">{{ text }}</span>
    <!-- The churn rides on top and is never read by anything. -->
    <span v-if="running" aria-hidden="true" class="absolute inset-0 whitespace-pre-wrap">{{
      overlay
    }}</span>
  </span>
</template>
