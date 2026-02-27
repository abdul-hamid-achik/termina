<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'

interface LogEvent {
  tick: number
  text: string
  type: 'damage' | 'healing' | 'kill' | 'gold' | 'system' | 'ability'
}

const props = defineProps<{
  events: LogEvent[]
}>()

const logEl = ref<HTMLElement>()
const pinned = ref(false)

function scrollToBottom() {
  if (logEl.value && !pinned.value) {
    logEl.value.scrollTop = logEl.value.scrollHeight
  }
}

watch(
  () => props.events.length,
  () => nextTick(scrollToBottom),
)

onMounted(scrollToBottom)

function handleScroll() {
  if (!logEl.value) return
  const { scrollTop, scrollHeight, clientHeight } = logEl.value
  const atBottom = scrollHeight - scrollTop - clientHeight < 20
  if (atBottom) pinned.value = false
}

function togglePin() {
  pinned.value = !pinned.value
  if (!pinned.value) nextTick(scrollToBottom)
}

function typeColor(type: LogEvent['type']): string {
  const map: Record<string, string> = {
    damage: 'var(--color-damage)',
    healing: 'var(--color-healing)',
    kill: 'var(--color-dire)',
    gold: 'var(--color-gold)',
    system: 'var(--color-system)',
    ability: 'var(--color-ability)',
  }
  return map[type] ?? 'var(--text-primary)'
}
</script>

<template>
  <div class="combat-log-wrapper">
    <div
      v-if="pinned"
      class="combat-log__pin"
      @click="togglePin"
    >
      [scroll pinned — click to unpin]
    </div>
    <div
      ref="logEl"
      class="combat-log"
      @scroll="handleScroll"
      @click="togglePin"
    >
      <div
        v-for="(event, i) in events"
        :key="i"
        class="combat-log__entry"
        :class="`combat-log__entry--${event.type}`"
      >
        <span class="combat-log__tick">[T{{ event.tick }}]</span>
        <span :style="{ color: typeColor(event.type) }">{{ event.text }}</span>
      </div>
      <div v-if="!events.length" class="combat-log__empty">
        &gt;_ awaiting events...
      </div>
    </div>
  </div>
</template>

<style scoped>
.combat-log-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.combat-log__pin {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 2px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  color: var(--text-dim);
  font-size: 0.7rem;
  text-align: center;
  cursor: pointer;
  z-index: 1;
}

.combat-log {
  flex: 1;
  overflow-y: auto;
  font-size: 0.8rem;
  line-height: 1.5;
  padding: 4px 0;
}

.combat-log__entry {
  padding: 1px 8px;
  border-left: 2px solid transparent;
}

.combat-log__entry:hover {
  background: rgba(255, 255, 255, 0.02);
}

.combat-log__entry--damage {
  border-left-color: var(--color-damage);
}

.combat-log__entry--healing {
  border-left-color: var(--color-healing);
}

.combat-log__entry--kill {
  border-left-color: var(--color-dire);
  font-weight: 700;
}

.combat-log__entry--gold {
  border-left-color: var(--color-gold);
}

.combat-log__entry--system {
  border-left-color: var(--color-system);
  color: var(--text-dim);
}

.combat-log__entry--ability {
  border-left-color: var(--color-ability);
}

.combat-log__tick {
  color: var(--text-dim);
  font-size: 0.7rem;
  margin-right: 4px;
}

.combat-log__empty {
  color: var(--text-dim);
  padding: 8px;
  font-size: 0.8rem;
}
</style>
