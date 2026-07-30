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
    type="button"
    class="group inline-flex items-center gap-1 border px-1 py-1.5 font-mono text-sm transition-all duration-100 select-none"
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
    :disabled="disabled"
    @click="$emit('click', $event)"
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
  </button>
</template>
