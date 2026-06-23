<script setup lang="ts">
import type { AbilityDef } from '~~/shared/types/hero'
import { TICK_DURATION_MS } from '~~/shared/constants/balance'
import { formatEffect, cooldownSeconds } from '~~/shared/abilityFormat'

const props = defineProps<{
  /** Display key: Q / W / E / R, or ◆ for the passive. */
  slotKey: string
  ability: AbilityDef
  /** Ticks of cooldown remaining; 0/undefined = ready. */
  cooldownRemaining?: number
  /** Current mana, to dim unaffordable casts; undefined = not tracked. */
  manaAvailable?: number
  /** Render as a clickable button that emits `cast`. */
  interactive?: boolean
}>()

const emit = defineEmits<{ cast: [] }>()

const onCooldown = computed(() => (props.cooldownRemaining ?? 0) > 0)
const unaffordable = computed(
  () => props.manaAvailable !== undefined && props.manaAvailable < props.ability.manaCost,
)
const disabled = computed(() => onCooldown.value || unaffordable.value)
const cdSeconds = computed(() => cooldownSeconds(props.ability, TICK_DURATION_MS))

function onClick() {
  if (props.interactive && !disabled.value) emit('cast')
}
</script>

<template>
  <component
    :is="interactive ? 'button' : 'div'"
    type="button"
    :data-testid="`ability-${slotKey.toLowerCase()}`"
    class="flex w-full flex-col gap-1.5 border p-2.5 text-left transition-colors"
    :class="[
      onCooldown ? 'border-border/50 opacity-50' : 'border-border',
      interactive && !disabled ? 'cursor-pointer hover:border-ability hover:bg-ability/5' : '',
      interactive && disabled ? 'cursor-not-allowed' : '',
    ]"
    :disabled="interactive && disabled"
    @click="onClick"
  >
    <div class="flex items-center gap-2">
      <span
        class="flex h-6 w-6 shrink-0 items-center justify-center border border-ability text-[0.72rem] font-bold text-ability"
      >
        {{ slotKey }}
      </span>
      <span class="text-[0.85rem] font-bold text-text-primary">{{ ability.name }}</span>
      <span v-if="onCooldown" class="ml-auto text-[0.7rem] text-gold"
        >CD {{ cooldownRemaining }}t</span
      >
      <span v-else-if="unaffordable" class="ml-auto text-[0.7rem] text-dire">no mp</span>
    </div>

    <div v-if="ability.effects.length" class="flex flex-wrap gap-1">
      <span
        v-for="(e, i) in ability.effects"
        :key="i"
        class="border border-border bg-bg-secondary px-1 py-0.5 text-[0.65rem] text-text-dim"
      >
        {{ formatEffect(e) }}
      </span>
    </div>

    <p class="text-[0.72rem] leading-snug text-text-dim">{{ ability.description }}</p>

    <div class="flex gap-3 text-[0.65rem] text-text-dim">
      <span v-if="ability.manaCost > 0"
        ><span class="text-ability">mp</span> {{ ability.manaCost }}</span
      >
      <span v-if="ability.cooldownTicks > 0"
        ><span class="text-ability">cd</span> {{ cdSeconds }}s</span
      >
      <span class="uppercase">{{ ability.targetType }}</span>
    </div>
  </component>
</template>
