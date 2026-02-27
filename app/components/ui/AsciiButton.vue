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
    class="ascii-btn"
    :class="{
      'ascii-btn--primary': variant === 'primary',
      'ascii-btn--danger': variant === 'danger',
      'ascii-btn--ghost': variant === 'ghost',
      'ascii-btn--disabled': disabled,
    }"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <span class="ascii-btn__bracket">[</span>
    <span class="ascii-btn__label">{{ label }}</span>
    <span class="ascii-btn__bracket">]</span>
  </button>
</template>

<style scoped>
.ascii-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.1s;
  user-select: none;
}

.ascii-btn:hover {
  border-color: var(--border-glow);
  background: rgba(42, 42, 78, 0.2);
}

.ascii-btn:active {
  background: var(--text-primary);
  color: var(--bg-primary);
}

.ascii-btn__bracket {
  color: var(--text-dim);
}

.ascii-btn__label {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0 4px;
}

/* Primary */
.ascii-btn--primary {
  border-color: var(--color-radiant);
}

.ascii-btn--primary .ascii-btn__bracket {
  color: var(--color-radiant);
}

.ascii-btn--primary:hover {
  background: rgba(46, 204, 113, 0.1);
  box-shadow: 0 0 8px rgba(46, 204, 113, 0.2);
}

.ascii-btn--primary:active {
  background: var(--color-radiant);
  color: var(--bg-primary);
}

/* Danger */
.ascii-btn--danger {
  border-color: var(--color-dire);
}

.ascii-btn--danger .ascii-btn__bracket {
  color: var(--color-dire);
}

.ascii-btn--danger:hover {
  background: rgba(233, 69, 96, 0.1);
  box-shadow: 0 0 8px rgba(233, 69, 96, 0.2);
}

.ascii-btn--danger:active {
  background: var(--color-dire);
  color: var(--bg-primary);
}

/* Ghost */
.ascii-btn--ghost {
  border-color: transparent;
}

.ascii-btn--ghost:hover {
  border-color: var(--border-color);
}

/* Disabled */
.ascii-btn--disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}
</style>
