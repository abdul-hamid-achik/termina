<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { heroPixelData } from './pixelData'

const props = withDefaults(
  defineProps<{
    heroId: string
    size?: number
  }>(),
  { size: 48 },
)

const canvas = ref<HTMLCanvasElement | null>(null)

function draw() {
  const el = canvas.value
  if (!el) return

  const grid = heroPixelData[props.heroId]
  if (!grid) return

  const ctx = el.getContext('2d')
  if (!ctx) return

  el.width = 16
  el.height = 16
  ctx.clearRect(0, 0, 16, 16)

  for (let y = 0; y < grid.length; y++) {
    const row = grid[y]!
    for (let x = 0; x < row.length; x++) {
      const color = row[x]
      if (!color) continue
      ctx.fillStyle = color as string
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

onMounted(draw)
watch(() => props.heroId, draw)
</script>

<template>
  <div
    class="inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-bg-secondary"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      boxShadow: '0 0 6px rgba(42, 42, 78, 0.4)',
    }"
  >
    <canvas
      ref="canvas"
      class="block"
      :style="{
        width: `${size}px`,
        height: `${size}px`,
        imageRendering: 'pixelated',
      }"
    />
  </div>
</template>
