<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'

/**
 * A transient, MOBA-style action-feedback toast. The server forwards every
 * rejected action (out of range, juked target, firewalled Ancient, not enough
 * mana, …) as an `announcement`; this surfaces the latest one briefly near the
 * top of the play area so the player learns WHY nothing happened, instead of the
 * message dying silently in the store.
 *
 * Driven by (`text`, `seq`): `seq` is a monotonic counter so a repeated or
 * identical message still re-shows the toast. Kept pure/props-only so it is
 * trivially storyable and testable with fake timers.
 */
type ToastLevel = 'info' | 'warning' | 'kill' | 'objective' | 'error'

const props = withDefaults(
  defineProps<{
    /** The message to show (the most recent announcement). */
    text: string
    /** Monotonic announcement counter — bumps each time a new one arrives. */
    seq: number
    /** Severity, drives the colour. Defaults to a warning. */
    level?: ToastLevel
    /** How long the toast stays up, in ms. */
    durationMs?: number
  }>(),
  { level: 'warning', durationMs: 3200 },
)

const visible = ref(false)
const shown = ref('')
// Snapshot the level alongside the text when the toast fires, so a later prop
// change for the NEXT announcement can't recolour the one on screen.
const shownLevel = ref<ToastLevel>('warning')
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.seq,
  (seq) => {
    if (seq <= 0 || !props.text) return
    shown.value = props.text
    shownLevel.value = props.level
    visible.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      visible.value = false
    }, props.durationMs)
  },
)

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})

// error/kill read as dire, objective as gold, info as a neutral blue, and
// ordinary rejections as amber warnings.
const toneClass = computed(() => {
  switch (shownLevel.value) {
    case 'error':
    case 'kill':
      return 'border-dire text-dire'
    case 'objective':
      return 'border-gold text-gold'
    case 'info':
      return 'border-self text-self'
    default:
      return 'border-warn text-warn'
  }
})
const icon = computed(() => {
  switch (shownLevel.value) {
    case 'error':
    case 'kill':
      return '✕'
    case 'info':
      return 'i'
    case 'objective':
      return '★'
    default:
      return '!'
  }
})
// Strip the synthetic [ERROR] prefix — the colour already conveys severity.
const display = computed(() => shown.value.replace(/^\[ERROR\]\s*/, ''))
</script>

<template>
  <Transition name="toast-pop">
    <div
      v-if="visible"
      class="announcement-toast pointer-events-none absolute left-1/2 top-3 z-50 -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div
        class="t-mono flex items-center gap-2 rounded border bg-bg-panel/95 px-3 py-1.5 text-sm shadow-lg backdrop-blur-sm"
        :class="toneClass"
      >
        <span aria-hidden="true" class="font-bold">{{ icon }}</span>
        <span>{{ display }}</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.toast-pop-enter-active {
  transition:
    opacity 0.12s ease-out,
    transform 0.12s ease-out;
}
.toast-pop-leave-active {
  transition:
    opacity 0.4s ease-in,
    transform 0.4s ease-in;
}
.toast-pop-enter-from {
  opacity: 0;
  transform: translate(-50%, -8px);
}
.toast-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, -4px);
}
</style>
