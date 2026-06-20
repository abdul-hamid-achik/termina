<script setup lang="ts">
import { computed } from 'vue'

type ProgressBarColor =
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

const colorVars: Record<ProgressBarColor, string> = {
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
}

const props = withDefaults(
  defineProps<{
    value: number
    max?: number
    color?: ProgressBarColor
    width?: number
    showLabel?: boolean
    /** Ratio (0–1); at/below it the bar warns in `dangerColor` and pulses. 0 = off. */
    dangerBelow?: number
    dangerColor?: ProgressBarColor
  }>(),
  {
    max: 100,
    color: 'radiant',
    width: 20,
    showLabel: false,
    dangerBelow: 0,
    dangerColor: 'dire',
  },
)

const ratio = computed(() => (props.max > 0 ? props.value / props.max : 0))

// Low-resource warning: redden + pulse when alive (value > 0) but at/below the
// danger ratio. Opt-in — dangerBelow defaults to 0 (off) so existing bars are
// unchanged; HP bars pass e.g. 0.25 to flag "about to die" at a glance.
const inDanger = computed(
  () => props.dangerBelow > 0 && props.value > 0 && ratio.value <= props.dangerBelow,
)
const activeColor = computed(() => (inDanger.value ? props.dangerColor : props.color))
const activeColorStyle = computed(() => ({ color: `rgb(var(${colorVars[activeColor.value]}))` }))

const filled = computed(() => Math.round(Math.max(0, Math.min(1, ratio.value)) * props.width))

const empty = computed(() => props.width - filled.value)

const bar = computed(() => {
  return '█'.repeat(filled.value) + '░'.repeat(empty.value)
})

const percentage = computed(() => {
  return Math.round((props.value / props.max) * 100)
})
</script>

<template>
  <span class="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[0.8rem]">
    <span class="text-text-dim">[</span>
    <span
      class="tracking-normal"
      :class="{ 'animate-pulse': inDanger }"
      :data-danger="inDanger ? 'true' : undefined"
      data-testid="progress-bar-fill"
      :style="activeColorStyle"
      >{{ bar }}</span
    >
    <span class="text-text-dim">]</span>
    <span v-if="showLabel" class="text-text-primary text-xs">
      {{ value }}/{{ max }}
      <span class="text-text-dim">({{ percentage }}%)</span>
    </span>
  </span>
</template>
