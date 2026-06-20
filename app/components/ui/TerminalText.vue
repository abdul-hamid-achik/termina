<script setup lang="ts">
import { computed } from 'vue'

type TerminalTextColor =
  | 'radiant'
  | 'radiant-deep'
  | 'dire'
  | 'dire-deep'
  | 'self'
  | 'gold'
  | 'mana'
  | 'damage'
  | 'healing'
  | 'system'
  | 'zone'
  | 'ability'
  | 'warn'
  | 'text-primary'
  | 'text-dim'
  | 'text-muted'

const colorVars: Record<TerminalTextColor, string> = {
  radiant: '--color-radiant',
  'radiant-deep': '--color-radiant-deep',
  dire: '--color-dire',
  'dire-deep': '--color-dire-deep',
  self: '--color-self',
  gold: '--color-gold',
  mana: '--color-mana',
  damage: '--color-damage',
  healing: '--color-healing',
  system: '--color-system',
  zone: '--color-zone',
  ability: '--color-ability',
  warn: '--color-warn',
  'text-primary': '--text-primary',
  'text-dim': '--text-dim',
  'text-muted': '--text-muted',
}

const props = defineProps<{
  color?: TerminalTextColor
  bold?: boolean
  dim?: boolean
}>()

const colorStyle = computed(() =>
  props.color ? { color: `rgb(var(${colorVars[props.color]}))` } : undefined,
)
</script>

<template>
  <span class="font-mono" :class="{ 'font-bold': bold, 'opacity-60': dim }" :style="colorStyle">
    <slot />
  </span>
</template>
