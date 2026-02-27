<script setup lang="ts">
defineProps<{
  label: string
  disabled?: boolean
  variant?: 'primary' | 'danger' | 'ghost'
}>()

defineEmits<{
  click: [e: MouseEvent]
}>()
</script>

<template>
  <button
    class="group inline-flex items-center gap-1 border px-1 py-1.5 font-mono text-sm transition-all duration-100 select-none"
    :class="[
      disabled ? 'pointer-events-none cursor-not-allowed opacity-35' : 'cursor-pointer',
      variant === 'primary'
        ? 'border-radiant hover:bg-radiant/10 hover:shadow-glow-radiant active:bg-radiant active:text-bg-primary'
        : variant === 'danger'
          ? 'border-dire hover:bg-dire/10 hover:shadow-glow-dire active:bg-dire active:text-bg-primary'
          : variant === 'ghost'
            ? 'border-transparent hover:border-border'
            : 'border-border bg-transparent text-text-primary hover:border-border-glow hover:bg-border-glow/20 active:bg-text-primary active:text-bg-primary',
    ]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <span
      class="transition-colors duration-100"
      :class="
        variant === 'primary'
          ? 'text-radiant'
          : variant === 'danger'
            ? 'text-dire'
            : 'text-text-dim'
      "
      >[</span
    >
    <span class="px-1 uppercase tracking-widest">{{ label }}</span>
    <span
      class="transition-colors duration-100"
      :class="
        variant === 'primary'
          ? 'text-radiant'
          : variant === 'danger'
            ? 'text-dire'
            : 'text-text-dim'
      "
      >]</span
    >
  </button>
</template>
