<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

/**
 * Decode effect: every character churns through random glyphs and locks into
 * the real one, left to right.
 *
 * Two things make this safe rather than decorative noise:
 *
 * 1. The churning text is `aria-hidden` and the real string is exposed once in a
 *    visually-hidden span. A screen reader announces "where every command is a
 *    kill", never the garbage. Without that split the effect is an accessibility
 *    trap — the DOM genuinely contains nonsense for most of its runtime.
 *
 *    This used to be an `aria-label` on the wrapper `<span>`. That silently did
 *    nothing: `aria-label` is only honoured on elements with a widget/landmark
 *    role, and a bare span is `generic`. With both children `aria-hidden` the
 *    net effect was that every scrambled line — including the landing page's
 *    headline and subhead — was completely absent from the accessibility tree.
 * 2. Under `prefers-reduced-motion` it renders the final text immediately and
 *    never starts a frame loop, so there is no work and no motion at all.
 *
 * The harden pool is deliberately fixed-width-friendly and the host must be
 * monospaced (`font-mono` is applied here): a proportional font re-flows on
 * every frame as glyphs swap, which reads as jitter and can shift layout.
 */
const props = withDefaults(
  defineProps<{
    text: string
    /** Ms each character churns before it settles. Stagger is derived from it. */
    speed?: number
    /** Ms before the first character starts. Lets callers cascade several lines. */
    delay?: number
    /** Re-run whenever `text` changes (headings that swap between sections). */
    replayOnChange?: boolean
  }>(),
  { speed: 420, delay: 0, replayOnChange: true },
)

// Box-drawing and operator glyphs only — they share the monospace advance width
// and read as "terminal decoding" rather than as random letters, which would
// look like a typo mid-churn.
const GLYPHS = '01<>[]{}/\\|=+*#%$&@~^:;·─│╱╲'

const rendered = ref(props.text)
let frame: number | null = null
let startedAt = 0

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

function stop() {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
}

function run() {
  stop()
  const target = props.text
  if (!target || prefersReducedMotion()) {
    rendered.value = target
    return
  }

  // Each character gets its own settle deadline, spread across the run so the
  // lock-in sweeps left to right instead of resolving all at once.
  const perChar = target.length > 0 ? props.speed / target.length : 0
  const deadlines = [...target].map((_, i) => props.delay + props.speed * 0.45 + i * perChar)
  startedAt = performance.now()
  rendered.value = ''

  const tick = () => {
    const elapsed = performance.now() - startedAt
    let settled = 0
    let out = ''
    for (let i = 0; i < target.length; i++) {
      const char = target[i]!
      // Whitespace never churns — a moving gap reads as a layout bug.
      if (elapsed >= deadlines[i]! || char === ' ') {
        out += char
        settled++
      } else if (elapsed < props.delay) {
        // Before our turn: hold the space so the line's width is stable from
        // frame one and nothing below it shifts.
        out += ' '
      } else {
        out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
    }
    rendered.value = out
    if (settled === target.length) {
      frame = null
      return
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
}

onMounted(run)
onUnmounted(stop)
watch(
  () => props.text,
  () => {
    if (props.replayOnChange) run()
    else rendered.value = props.text
  },
)

// Reserve the final width up front. The churning span is absolutely positioned
// over a transparent copy of the real string, so the element never resizes as
// characters settle — the single most common way this effect breaks a layout.
const sizer = computed(() => props.text)
</script>

<template>
  <span class="relative inline-block whitespace-pre font-mono tabular-nums">
    <!-- The only copy assistive tech sees. `sr-only` clips rather than hiding,
         so it stays in the accessibility tree; `invisible` below does not. -->
    <span class="sr-only">{{ text }}</span>
    <span aria-hidden="true" class="invisible">{{ sizer }}</span>
    <span aria-hidden="true" class="absolute inset-0">{{ rendered }}</span>
  </span>
</template>
