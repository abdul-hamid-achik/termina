<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'

interface LogEvent {
  tick: number
  text: string
  type: 'damage' | 'healing' | 'kill' | 'gold' | 'system' | 'ability'
  killerHeroId?: string
  victimHeroId?: string
}

const props = defineProps<{
  events: LogEvent[]
}>()

const logEl = ref<HTMLElement>()
const pinned = ref(false)
const lastEvent = ref<LogEvent | null>(null)

function scrollToBottom() {
  if (logEl.value && !pinned.value) {
    logEl.value.scrollTop = logEl.value.scrollHeight
  }
}

watch(
  () => props.events.length,
  (newLen, oldLen) => {
    if (newLen > (oldLen ?? 0) && props.events.length > 0) {
      lastEvent.value = props.events[props.events.length - 1]!
    }
    nextTick(scrollToBottom)
  },
)

onMounted(scrollToBottom)

function handleScroll() {
  if (!logEl.value) return
  const { scrollTop, scrollHeight, clientHeight } = logEl.value
  const atBottom = scrollHeight - scrollTop - clientHeight < 20
  pinned.value = !atBottom
}

function togglePin() {
  pinned.value = !pinned.value
  if (!pinned.value) nextTick(scrollToBottom)
}

const borderColors: Record<string, string> = {
  damage: 'border-l-damage',
  healing: 'border-l-healing',
  kill: 'border-l-dire font-bold',
  gold: 'border-l-gold',
  system: 'border-l-system text-text-dim',
  ability: 'border-l-ability',
}

function typeColor(type: LogEvent['type']): string {
  const map: Record<string, string> = {
    damage: 'rgb(var(--color-damage))',
    healing: 'rgb(var(--color-healing))',
    kill: 'rgb(var(--color-dire))',
    gold: 'rgb(var(--color-gold))',
    system: 'rgb(var(--color-system))',
    ability: 'rgb(var(--color-ability))',
  }
  return map[type] ?? 'rgb(var(--text-primary))'
}

function typePrefix(type: LogEvent['type']): string {
  const map: Record<string, string> = {
    damage: '[DAMAGE]',
    healing: '[HEAL]',
    kill: '[KILL]',
    gold: '[GOLD]',
    system: '[SYS]',
    ability: '[ABILITY]',
  }
  return map[type] ?? ''
}

function eventAriaLabel(event: LogEvent): string {
  return `${typePrefix(event.type)} Tick ${event.tick}: ${event.text}`
}
</script>

<template>
  <div class="relative flex h-full flex-col" data-testid="combat-log">
    <div aria-live="polite" class="sr-only">
      {{ lastEvent ? eventAriaLabel(lastEvent) : '' }}
    </div>

    <div
      v-if="pinned"
      class="absolute inset-x-0 top-0 z-[1] cursor-pointer border-b border-border bg-bg-secondary px-2 py-0.5 text-center text-[0.7rem] text-text-dim"
      @click="togglePin"
    >
      [scroll pinned — click to unpin]
    </div>
    <div
      ref="logEl"
      class="flex-1 overflow-y-auto py-1 text-[0.8rem] leading-normal"
      @scroll="handleScroll"
    >
      <div
        v-for="(event, i) in events"
        :key="`${event.tick}-${event.type}-${i}`"
        data-testid="log-event"
        :aria-label="eventAriaLabel(event)"
        class="border-l-2 border-l-transparent px-2 py-px hover:bg-white/[0.02]"
        :class="borderColors[event.type]"
      >
        <span class="mr-1 text-[0.7rem] text-text-dim">[T{{ event.tick }}]</span>
        <span class="mr-1 text-[0.65rem] font-bold" :style="{ color: typeColor(event.type) }">{{
          typePrefix(event.type)
        }}</span>
        <HeroAvatar
          v-if="event.type === 'kill' && event.killerHeroId"
          :hero-id="event.killerHeroId"
          :size="16"
          class="mr-1 inline-flex align-middle"
        />
        <span :style="{ color: typeColor(event.type) }">{{ event.text }}</span>
        <HeroAvatar
          v-if="event.type === 'kill' && event.victimHeroId"
          :hero-id="event.victimHeroId"
          :size="16"
          class="ml-1 inline-flex align-middle"
        />
      </div>
      <div v-if="!events.length" class="p-2 text-[0.8rem] text-text-dim">
        &gt;_ awaiting events...
      </div>
    </div>
  </div>
</template>
