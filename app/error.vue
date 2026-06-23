<script setup lang="ts">
import { computed } from 'vue'
import type { NuxtError } from '#app'

// Nuxt renders this OUTSIDE the layout when a route 404s or a fatal error is
// thrown, so it carries its own terminal-themed chrome (global terminal.css
// still applies via nuxt.config `css`).
const props = defineProps<{ error: NuxtError }>()

const code = computed(() => props.error?.statusCode ?? 500)
const is404 = computed(() => code.value === 404)
const headline = computed(() => (is404.value ? 'segment not found' : 'system fault'))
// A terminal-flavoured detail line; fall back to a generic message.
const detail = computed(
  () =>
    props.error?.statusMessage ||
    props.error?.message ||
    (is404.value
      ? 'No process is listening at that path.'
      : 'An unexpected fault interrupted the process.'),
)

// clearError tears down the error boundary; redirect home to recover.
function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <div
    class="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg-primary p-8 text-center text-text-primary max-sm:p-4"
  >
    <pre
      aria-hidden="true"
      class="m-0 text-[0.6rem] leading-[1.15] md:text-[0.85rem]"
      :class="is404 ? 'text-radiant text-glow' : 'text-dire text-glow-dire'"
      >{{ code }}</pre
    >

    <div class="flex flex-col items-center gap-2">
      <p class="text-base font-bold tracking-widest" :class="is404 ? 'text-radiant' : 'text-dire'">
        <span aria-hidden="true">&gt;_</span> ERROR {{ code }} — {{ headline }}
      </p>
      <p class="max-w-[460px] text-[0.82rem] text-text-dim">{{ detail }}</p>
    </div>

    <div class="flex flex-wrap justify-center gap-3">
      <AsciiButton label="RETURN HOME" variant="primary" @click="goHome" />
      <NuxtLink to="/learn" class="no-underline">
        <AsciiButton label="LEARN THE COMMANDS" variant="ghost" />
      </NuxtLink>
    </div>

    <div class="text-[0.8rem]">
      <span class="font-bold text-radiant">&gt;</span>
      <span class="ml-1 text-text-dim">retry_</span>
      <span aria-hidden="true" class="animate-blink">█</span>
    </div>
  </div>
</template>
