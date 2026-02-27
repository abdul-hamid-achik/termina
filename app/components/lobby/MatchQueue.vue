<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

defineProps<{
  playersInQueue?: number
  estimatedWaitSeconds?: number
}>()

const emit = defineEmits<{
  cancel: []
}>()

const elapsed = ref(0)
const dots = ref('')
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let dotsTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  elapsedTimer = setInterval(() => {
    elapsed.value++
  }, 1000)

  dotsTimer = setInterval(() => {
    dots.value = dots.value.length >= 3 ? '' : dots.value + '.'
  }, 500)
})

onUnmounted(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
  if (dotsTimer) clearInterval(dotsTimer)
})

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-bg-primary p-4">
    <TerminalPanel title="Matchmaking">
      <div class="flex min-w-[320px] flex-col items-center gap-4 p-6">
        <div class="text-center">
          <span class="text-base font-bold tracking-wide text-ability"
            >Searching for match{{ dots }}</span
          >
        </div>

        <div class="flex w-full flex-col gap-1">
          <div class="flex justify-between py-0.5 text-[0.8rem]">
            <span class="text-text-dim">Elapsed:</span>
            <span class="font-bold text-text-primary">{{ formatTime(elapsed) }}</span>
          </div>
          <div v-if="estimatedWaitSeconds" class="flex justify-between py-0.5 text-[0.8rem]">
            <span class="text-text-dim">Est. wait:</span>
            <span class="font-bold text-text-primary">~{{ formatTime(estimatedWaitSeconds) }}</span>
          </div>
          <div v-if="playersInQueue" class="flex justify-between py-0.5 text-[0.8rem]">
            <span class="text-text-dim">In queue:</span>
            <span class="font-bold text-text-primary">{{ playersInQueue }} players</span>
          </div>
        </div>

        <div class="p-2">
          <span class="animate-blink text-2xl text-radiant">|</span>
        </div>

        <div class="pt-2">
          <AsciiButton label="CANCEL" variant="danger" @click="emit('cancel')" />
        </div>
      </div>
    </TerminalPanel>
  </div>
</template>
