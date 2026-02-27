<script setup lang="ts">
import { TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal } from 'reka-ui'

withDefaults(
  defineProps<{
    text: string
    position?: 'top' | 'bottom' | 'left' | 'right'
  }>(),
  {
    position: 'top',
  },
)
</script>

<template>
  <TooltipRoot>
    <TooltipTrigger as-child>
      <span class="inline-flex">
        <slot />
      </span>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side="position"
        :side-offset="6"
        class="z-[100] whitespace-nowrap border border-border bg-bg-secondary px-2 py-1 font-mono text-[0.7rem] text-text-primary"
      >
        {{ text }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
