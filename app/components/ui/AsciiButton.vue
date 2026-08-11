<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  disabled?: boolean
  variant?: 'primary' | 'danger' | 'ghost'
  /**
   * When set, the control navigates — it renders AS the link (NuxtLink),
   * never a <button> nested inside an <a>. Callers used to wrap
   * `<NuxtLink to="..."><AsciiButton /></NuxtLink>`, which is invalid HTML
   * (interactive-in-interactive) and breaks assistive tech: the nested
   * <button> steals the accessible name/role and screen readers announce
   * two controls for one action. Pass `to` instead of wrapping. Omit for
   * action buttons that emit `click`.
   */
  to?: string
}>()

const emit = defineEmits<{
  click: [e: MouseEvent]
}>()

// button (no `to`) | NuxtLink (`to`, enabled) | span (`to`, disabled — a
// disabled link has nowhere valid to point, so it degrades to inert text
// rather than a focusable no-op anchor).
const rootTag = computed(() => (props.to ? (props.disabled ? 'span' : 'NuxtLink') : 'button'))

const rootAttrs = computed(() => {
  if (!props.to) return { type: 'button', disabled: props.disabled }
  if (props.disabled) return { 'aria-disabled': 'true' }
  return { to: props.to }
})

function onClick(e: MouseEvent) {
  if (props.disabled) return
  emit('click', e)
}
</script>

<template>
  <component
    :is="rootTag"
    v-bind="rootAttrs"
    class="group inline-flex items-center gap-1 border px-1 py-1.5 font-mono text-sm no-underline transition-all duration-100 select-none touch-target"
    :class="[
      disabled ? 'pointer-events-none cursor-not-allowed opacity-35' : 'cursor-pointer',
      variant === 'primary'
        ? 'border-chaff hover:bg-chaff/10 hover:shadow-glow-chaff active:bg-chaff active:text-bg-primary'
        : variant === 'danger'
          ? 'border-audit hover:bg-audit/10 hover:shadow-glow-audit active:bg-audit active:text-bg-primary'
          : variant === 'ghost'
            ? 'border-transparent hover:border-border'
            : 'border-border bg-transparent text-text-primary hover:border-border-glow hover:bg-border-glow/20 active:bg-text-primary active:text-bg-primary',
    ]"
    @click="onClick"
  >
    <span
      class="transition-colors duration-100"
      :class="
        variant === 'primary' ? 'text-chaff' : variant === 'danger' ? 'text-audit' : 'text-text-dim'
      "
      >[</span
    >
    <span class="px-1 uppercase tracking-widest">{{ label }}</span>
    <span
      class="transition-colors duration-100"
      :class="
        variant === 'primary' ? 'text-chaff' : variant === 'danger' ? 'text-audit' : 'text-text-dim'
      "
      >]</span
    >
  </component>
</template>
