<script setup lang="ts">
import { ref } from 'vue'

const queueStatus = ref<'idle' | 'searching' | 'found'>('idle')
const queueTime = ref(0)

let interval: ReturnType<typeof setInterval> | null = null

function joinQueue() {
  queueStatus.value = 'searching'
  queueTime.value = 0
  interval = setInterval(() => {
    queueTime.value++
  }, 1000)
}

function leaveQueue() {
  queueStatus.value = 'idle'
  queueTime.value = 0
  if (interval) clearInterval(interval)
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="lobby-page">
    <TerminalPanel title="Matchmaking">
      <div class="lobby-content">
        <template v-if="queueStatus === 'idle'">
          <p class="lobby-text">&gt;_ ready to queue</p>
          <p class="lobby-hint">Find a match (3v3 — Radiant vs Dire)</p>
          <AsciiButton label="FIND MATCH" variant="primary" @click="joinQueue" />
        </template>

        <template v-else-if="queueStatus === 'searching'">
          <div class="queue-spinner">
            <span class="queue-dots">searching</span>
            <span class="cursor-blink">_</span>
          </div>
          <p class="queue-time">Queue time: {{ formatTime(queueTime) }}</p>
          <p class="queue-info">Players in queue: --</p>
          <AsciiButton label="CANCEL" variant="danger" @click="leaveQueue" />
        </template>

        <template v-else>
          <p class="lobby-text match-found text-glow">&gt;_ MATCH FOUND</p>
          <p class="lobby-hint">Preparing game session...</p>
        </template>
      </div>
    </TerminalPanel>
  </div>
</template>

<style scoped>
.lobby-page {
  max-width: 500px;
  margin: 40px auto;
}

.lobby-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
}

.lobby-text {
  font-size: 1rem;
  color: var(--text-primary);
}

.lobby-hint {
  font-size: 0.8rem;
  color: var(--text-dim);
}

.queue-spinner {
  font-size: 1rem;
  color: var(--color-ability);
}

.queue-time {
  font-size: 0.85rem;
  color: var(--color-gold);
}

.queue-info {
  font-size: 0.8rem;
  color: var(--text-dim);
}

.match-found {
  color: var(--color-radiant);
  font-weight: 700;
}
</style>
