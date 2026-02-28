<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps<{
  playersInQueue?: number
  estimatedWaitSeconds?: number
  roster?: { username: string; mmrBracket: string }[]
  matchSize?: number
  botsFilling?: boolean
  botsCount?: number
}>()

const emit = defineEmits<{
  cancel: []
}>()

const totalSlots = computed(() => props.matchSize ?? 10)

// Typing animation state: tracks which slots have finished "typing in"
const typedSlots = ref<Set<number>>(new Set())
const typingSlot = ref<number | null>(null)

// Bot names that have been "typed in" during filling
const filledBotNames = ref<string[]>([])
const botTypingActive = ref(false)

const BOT_DISPLAY_NAMES = [
  'Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta', 'Bot Epsilon',
  'Bot Zeta', 'Bot Eta', 'Bot Theta', 'Bot Iota', 'Bot Kappa',
]

// Elapsed timer
const elapsed = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | null = null

// Blinking cursor
const cursorVisible = ref(true)
let cursorTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  elapsedTimer = setInterval(() => {
    elapsed.value++
  }, 1000)

  cursorTimer = setInterval(() => {
    cursorVisible.value = !cursorVisible.value
  }, 530)
})

onUnmounted(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
  if (cursorTimer) clearInterval(cursorTimer)
  if (typeTimer) clearInterval(typeTimer)
  if (botFillTimer) clearInterval(botFillTimer)
})

// Animate roster slots typing in
let typeTimer: ReturnType<typeof setInterval> | null = null

watch(
  () => props.roster,
  (newRoster) => {
    if (!newRoster) return
    // Find slots that haven't been typed yet
    for (let i = 0; i < newRoster.length; i++) {
      if (!typedSlots.value.has(i)) {
        // Animate this slot
        typingSlot.value = i
        if (typeTimer) clearInterval(typeTimer)
        typeTimer = setTimeout(() => {
          typedSlots.value = new Set([...typedSlots.value, i])
          typingSlot.value = null
        }, 400 + Math.random() * 200) as unknown as ReturnType<typeof setInterval>
      }
    }
  },
  { deep: true, immediate: true },
)

// Bot filling animation
let botFillTimer: ReturnType<typeof setInterval> | null = null

watch(
  () => props.botsFilling,
  (filling) => {
    if (filling && props.botsCount && props.botsCount > 0) {
      botTypingActive.value = true
      let idx = 0
      const total = props.botsCount
      botFillTimer = setInterval(() => {
        if (idx < total) {
          filledBotNames.value = [...filledBotNames.value, BOT_DISPLAY_NAMES[idx] ?? `Bot ${idx + 1}`]
          idx++
        } else {
          botTypingActive.value = false
          if (botFillTimer) clearInterval(botFillTimer)
        }
      }, 350)
    }
  },
)

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Build the visual slot list
const slots = computed(() => {
  const result: {
    type: 'player' | 'bot' | 'empty' | 'typing'
    username?: string
    mmrBracket?: string
    index: number
  }[] = []

  const rosterLen = props.roster?.length ?? 0
  const botLen = filledBotNames.value.length

  // Real players
  for (let i = 0; i < rosterLen; i++) {
    const p = props.roster![i]!
    if (typingSlot.value === i && !typedSlots.value.has(i)) {
      result.push({ type: 'typing', index: i })
    } else {
      result.push({ type: 'player', username: p.username, mmrBracket: p.mmrBracket, index: i })
    }
  }

  // Bots that have typed in
  for (let i = 0; i < botLen; i++) {
    result.push({ type: 'bot', username: filledBotNames.value[i], index: rosterLen + i })
  }

  // Bot currently typing
  if (botTypingActive.value && botLen < (props.botsCount ?? 0)) {
    result.push({ type: 'typing', index: rosterLen + botLen })
  }

  // Empty waiting slots
  const filled = result.length
  for (let i = filled; i < totalSlots.value; i++) {
    result.push({ type: 'empty', index: i })
  }

  return result
})

const filledCount = computed(() => {
  return (props.roster?.length ?? 0) + filledBotNames.value.length
})
</script>

<template>
  <div class="w-full max-w-[480px]">
    <TerminalPanel title="Matchmaking">
      <div class="flex flex-col gap-3 p-4">
        <!-- Header: progress -->
        <div class="flex items-center justify-between">
          <span class="text-sm font-bold tracking-wide text-ability">
            {{ filledCount }}/{{ totalSlots }} Players Found
          </span>
          <span class="font-mono text-xs text-text-dim">
            {{ formatTime(elapsed) }}
          </span>
        </div>

        <!-- Progress bar -->
        <div class="h-1 w-full overflow-hidden bg-border">
          <div
            class="h-full bg-ability transition-all duration-500"
            :style="{ width: `${(filledCount / totalSlots) * 100}%` }"
          />
        </div>

        <!-- Bot filling banner -->
        <div
          v-if="botsFilling"
          class="flex items-center gap-2 border border-border-glow bg-bg-secondary px-3 py-1.5"
        >
          <span class="text-xs text-gold">&gt;&gt;</span>
          <span class="text-xs text-gold">Filling with AI opponents...</span>
          <span class="text-xs text-text-dim">({{ botsCount }} bots)</span>
        </div>

        <!-- Slot list -->
        <div class="flex flex-col gap-0.5">
          <div
            v-for="slot in slots"
            :key="slot.index"
            class="flex items-center gap-2 border-l-2 px-3 py-1"
            :class="{
              'border-radiant bg-radiant/5': slot.type === 'player',
              'border-gold bg-gold/5': slot.type === 'bot',
              'border-border bg-transparent': slot.type === 'empty',
              'border-ability bg-ability/5': slot.type === 'typing',
            }"
          >
            <!-- Slot number -->
            <span
              class="w-5 shrink-0 text-right font-mono text-[0.7rem]"
              :class="{
                'text-text-dim': slot.type === 'empty',
                'text-radiant': slot.type === 'player',
                'text-gold': slot.type === 'bot',
                'text-ability': slot.type === 'typing',
              }"
            >
              {{ String(slot.index + 1).padStart(2, '0') }}
            </span>

            <!-- Divider -->
            <span class="text-text-dim">│</span>

            <!-- Content -->
            <template v-if="slot.type === 'player'">
              <span class="flex-1 truncate text-xs text-text-primary">{{ slot.username }}</span>
              <span class="shrink-0 text-[0.65rem] text-text-dim">[{{ slot.mmrBracket }}]</span>
            </template>

            <template v-else-if="slot.type === 'bot'">
              <span class="flex-1 truncate text-xs text-gold">{{ slot.username }}</span>
              <span class="shrink-0 text-[0.65rem] text-text-dim">[AI]</span>
            </template>

            <template v-else-if="slot.type === 'typing'">
              <span class="flex-1 text-xs text-ability">
                <span class="animate-pulse">connecting</span>
                <span v-if="cursorVisible" class="text-ability">█</span>
              </span>
            </template>

            <template v-else>
              <span class="flex-1 text-xs text-text-dim">
                <span v-if="cursorVisible && slot.index === filledCount" class="text-border-glow">_</span>
                <span v-else>· · ·</span>
              </span>
            </template>
          </div>
        </div>

        <!-- Footer stats -->
        <div class="flex items-center justify-between border-t border-border pt-2">
          <div class="flex flex-col gap-0.5">
            <div v-if="estimatedWaitSeconds" class="text-[0.7rem] text-text-dim">
              Est. wait: ~{{ formatTime(estimatedWaitSeconds) }}
            </div>
          </div>
          <AsciiButton label="CANCEL" variant="danger" @click="emit('cancel')" />
        </div>
      </div>
    </TerminalPanel>
  </div>
</template>
