<script setup lang="ts">
import { TooltipProvider } from 'reka-ui'
import Tooltip from './Tooltip.vue'
import AsciiButton from './AsciiButton.vue'
</script>

<!--
  reka-ui tooltip wrapper. The content is portalled + hover/focus-gated, so each
  variant centers a trigger with room to open and wraps the Story in a
  TooltipProvider (delayDuration 0) so hovering shows the bubble immediately.
  Covers all four sides + a custom trigger element.
-->
<template>
  <Story title="UI/Tooltip" :layout="{ type: 'grid', width: 240 }">
    <template #default>
      <TooltipProvider :delay-duration="0">
        <Variant title="top (default)">
          <div class="flex items-center justify-center bg-bg-primary p-10">
            <Tooltip text="Tooltip on top">
              <span class="font-mono text-xs text-ability underline">hover me</span>
            </Tooltip>
          </div>
        </Variant>
        <Variant title="bottom">
          <div class="flex items-center justify-center bg-bg-primary p-10">
            <Tooltip text="Tooltip on bottom" position="bottom">
              <span class="font-mono text-xs text-ability underline">hover me</span>
            </Tooltip>
          </div>
        </Variant>
        <Variant title="left">
          <div class="flex items-center justify-center bg-bg-primary p-10">
            <Tooltip text="Tooltip on left" position="left">
              <span class="font-mono text-xs text-ability underline">hover me</span>
            </Tooltip>
          </div>
        </Variant>
        <Variant title="right">
          <div class="flex items-center justify-center bg-bg-primary p-10">
            <Tooltip text="Tooltip on right" position="right">
              <span class="font-mono text-xs text-ability underline">hover me</span>
            </Tooltip>
          </div>
        </Variant>

        <Variant title="on a button trigger">
          <div class="flex items-center justify-center bg-bg-primary p-10">
            <Tooltip text="Casts Pulse — 90 mana, 8s cooldown">
              <AsciiButton label="[Q] Pulse" variant="primary" />
            </Tooltip>
          </div>
        </Variant>

        <Variant title="long text">
          <div class="flex items-center justify-center bg-bg-primary p-10">
            <Tooltip
              text="Roshan grants the Aegis of the Immortal, reviving the bearer once on death."
            >
              <span class="font-mono text-xs text-gold underline">Roshan</span>
            </Tooltip>
          </div>
        </Variant>
      </TooltipProvider>
    </template>
  </Story>
</template>
