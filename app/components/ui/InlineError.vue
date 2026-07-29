<script setup lang="ts">
/**
 * A one-line failure message shown next to the control that failed.
 *
 * Exists because the "practice vs bots" button lives on five pages and used to
 * fail by silently navigating elsewhere — a player pressed it, landed on the
 * lobby, and could only conclude the button was broken. Any control that can
 * fail without navigating needs somewhere to say so.
 *
 * Renders nothing when there is no message, so callers can bind it directly to
 * a nullable ref without a v-if of their own.
 */
defineProps<{ message?: string | null }>()
</script>

<template>
  <p
    v-if="message"
    class="m-0 font-mono text-[0.78rem] text-dire"
    role="alert"
    aria-live="assertive"
    data-testid="inline-error"
  >
    &gt; {{ message }}
  </p>
</template>
