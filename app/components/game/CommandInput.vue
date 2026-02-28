<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

withDefaults(
  defineProps<{
    disabled?: boolean
    placeholder?: string
    tickCountdown?: number
  }>(),
  {
    placeholder: 'Enter command...',
    tickCountdown: 0,
  },
)

const emit = defineEmits<{
  submit: [command: string]
}>()

const input = ref('')
const inputEl = ref<HTMLInputElement>()
const history = ref<string[]>([])
const historyIndex = ref(-1)
const open = ref(false)

const commandList = [
  'move',
  'attack',
  'cast',
  'use',
  'buy',
  'sell',
  'ward',
  'scan',
  'status',
  'map',
  'chat',
  'ping',
]

const filtered = computed(() => {
  const val = input.value.trim().toLowerCase()
  if (!val) return commandList
  if (val.includes(' ')) return []
  return commandList.filter((c) => c.startsWith(val))
})

function handleSubmit() {
  const cmd = input.value.trim()
  if (!cmd) return
  emit('submit', cmd)
  history.value.unshift(cmd)
  if (history.value.length > 50) history.value.pop()
  historyIndex.value = -1
  input.value = ''
  open.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopImmediatePropagation()
    handleSubmit()
    return
  }

  if (e.key === 'ArrowUp' && !open.value) {
    e.preventDefault()
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++
      input.value = history.value[historyIndex.value] ?? ''
    }
  } else if (e.key === 'ArrowDown' && !open.value) {
    e.preventDefault()
    if (historyIndex.value > 0) {
      historyIndex.value--
      input.value = history.value[historyIndex.value] ?? ''
    } else if (historyIndex.value === 0) {
      historyIndex.value = -1
      input.value = ''
    }
  } else if (e.key === 'Tab') {
    e.preventDefault()
    if (filtered.value.length > 0) {
      open.value = true
    }
  } else if (e.key === 'Escape') {
    open.value = false
    input.value = ''
  }
}

watch(input, () => {
  historyIndex.value = -1
  if (input.value.includes(' ')) {
    open.value = false
  }
})

function handleSelect(val: string) {
  input.value = val + ' '
  open.value = false
  inputEl.value?.focus()
}

function focusInput() {
  inputEl.value?.focus()
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.cmd-input-wrapper')) {
    open.value = false
  }
}

onMounted(() => {
  focusInput()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="cmd-input-wrapper relative cursor-text" @click="focusInput">
    <div
      v-if="open && filtered.length > 0"
      class="absolute inset-x-0 bottom-full z-10 max-h-[200px] overflow-y-auto border border-border bg-bg-panel"
    >
      <div
        v-for="cmd in filtered"
        :key="cmd"
        class="cursor-pointer px-3 py-1 font-mono text-[0.8rem] text-text-primary hover:bg-border hover:text-ability"
        @click.stop="handleSelect(cmd)"
      >
        {{ cmd }}
      </div>
    </div>

    <div
      class="flex items-center gap-2 border-t border-border bg-bg-primary px-3 py-2"
      :class="{ 'opacity-50': disabled }"
    >
      <span class="shrink-0 font-bold text-radiant select-none">&gt;_</span>
      <input
        ref="inputEl"
        v-model="input"
        class="min-w-0 flex-1 border-none bg-transparent font-mono text-sm text-text-primary caret-radiant outline-none placeholder:text-text-dim placeholder:opacity-40"
        :disabled="disabled"
        :placeholder="placeholder"
        spellcheck="false"
        autocomplete="off"
        @keydown="handleKeydown"
      >
      <span
        v-if="!input"
        class="pointer-events-none absolute left-11 animate-blink text-sm text-radiant"
        >█</span
      >
      <span
        v-if="tickCountdown > 0"
        class="shrink-0 whitespace-nowrap text-[0.7rem] text-text-dim"
      >
        Next tick in {{ (tickCountdown / 1000).toFixed(1) }}s
      </span>
    </div>
  </div>
</template>
