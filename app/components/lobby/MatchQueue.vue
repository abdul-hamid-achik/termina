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
  <div class="match-queue">
    <TerminalPanel title="Matchmaking">
      <div class="mq__body">
        <div class="mq__status">
          <span class="mq__searching">Searching for match{{ dots }}</span>
        </div>

        <div class="mq__info">
          <div class="mq__row">
            <span class="mq__label">Elapsed:</span>
            <span class="mq__value">{{ formatTime(elapsed) }}</span>
          </div>
          <div v-if="estimatedWaitSeconds" class="mq__row">
            <span class="mq__label">Est. wait:</span>
            <span class="mq__value">~{{ formatTime(estimatedWaitSeconds) }}</span>
          </div>
          <div v-if="playersInQueue" class="mq__row">
            <span class="mq__label">In queue:</span>
            <span class="mq__value">{{ playersInQueue }} players</span>
          </div>
        </div>

        <div class="mq__spinner">
          <span class="mq__bar cursor-blink">|</span>
        </div>

        <div class="mq__actions">
          <AsciiButton
            label="CANCEL"
            variant="danger"
            @click="emit('cancel')"
          />
        </div>
      </div>
    </TerminalPanel>
  </div>
</template>

<style scoped>
.match-queue {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 16px;
  background: var(--bg-primary);
}

.mq__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
  min-width: 320px;
}

.mq__status {
  text-align: center;
}

.mq__searching {
  color: var(--color-ability);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.mq__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.mq__row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  padding: 2px 0;
}

.mq__label {
  color: var(--text-dim);
}

.mq__value {
  color: var(--text-primary);
  font-weight: 700;
}

.mq__spinner {
  padding: 8px;
}

.mq__bar {
  color: var(--color-radiant);
  font-size: 1.5rem;
}

.mq__actions {
  padding-top: 8px;
}
</style>
