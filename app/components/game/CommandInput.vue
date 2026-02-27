<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

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
const suggestions = ref<string[]>([])
const showSuggestions = ref(false)
const selectedSuggestion = ref(0)

const commandList = [
  'move', 'attack', 'cast', 'use', 'buy', 'sell',
  'ward', 'scan', 'status', 'map', 'chat', 'ping',
]

function handleSubmit() {
  const cmd = input.value.trim()
  if (!cmd) return
  emit('submit', cmd)
  history.value.unshift(cmd)
  if (history.value.length > 50) history.value.pop()
  historyIndex.value = -1
  input.value = ''
  showSuggestions.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (showSuggestions.value) {
      selectedSuggestion.value = Math.max(0, selectedSuggestion.value - 1)
    } else if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++
      input.value = history.value[historyIndex.value] ?? ''
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (showSuggestions.value) {
      selectedSuggestion.value = Math.min(suggestions.value.length - 1, selectedSuggestion.value + 1)
    } else if (historyIndex.value > 0) {
      historyIndex.value--
      input.value = history.value[historyIndex.value] ?? ''
    } else if (historyIndex.value === 0) {
      historyIndex.value = -1
      input.value = ''
    }
  } else if (e.key === 'Tab') {
    e.preventDefault()
    if (showSuggestions.value && suggestions.value.length) {
      input.value = suggestions.value[selectedSuggestion.value] + ' '
      showSuggestions.value = false
    } else {
      updateSuggestions()
    }
  } else if (e.key === 'Escape') {
    showSuggestions.value = false
    input.value = ''
  }
}

function updateSuggestions() {
  const val = input.value.trim().toLowerCase()
  if (!val) {
    suggestions.value = commandList
  } else {
    suggestions.value = commandList.filter(c => c.startsWith(val))
  }
  selectedSuggestion.value = 0
  showSuggestions.value = suggestions.value.length > 0
}

function handleInput() {
  historyIndex.value = -1
  if (input.value.includes(' ')) {
    showSuggestions.value = false
  }
}

function focusInput() {
  inputEl.value?.focus()
}

onMounted(() => {
  focusInput()
})

// Close suggestions on click outside
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.cmd-input-wrapper')) {
    showSuggestions.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="cmd-input-wrapper" @click="focusInput">
    <div v-if="showSuggestions" class="tab-completion">
      <div
        v-for="(s, i) in suggestions"
        :key="s"
        class="tab-completion__item"
        :class="{ 'tab-completion__item--active': i === selectedSuggestion }"
        @click.stop="input = s + ' '; showSuggestions = false"
      >
        {{ s }}
      </div>
    </div>

    <div class="cmd-input" :class="{ 'cmd-input--disabled': disabled }">
      <span class="cmd-input__prompt">&gt;_</span>
      <input
        ref="inputEl"
        v-model="input"
        class="cmd-input__field"
        :disabled="disabled"
        :placeholder="placeholder"
        spellcheck="false"
        autocomplete="off"
        @keydown.enter="handleSubmit"
        @keydown="handleKeydown"
        @input="handleInput"
      >
      <span v-if="!input" class="cursor-blink cmd-input__cursor">█</span>
      <span v-if="tickCountdown > 0" class="cmd-input__tick">
        Next tick in {{ (tickCountdown / 1000).toFixed(1) }}s
      </span>
    </div>
  </div>
</template>

<style scoped>
.cmd-input-wrapper {
  position: relative;
  cursor: text;
}

.cmd-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-primary);
  border-top: 1px solid var(--border-color);
}

.cmd-input--disabled {
  opacity: 0.5;
}

.cmd-input__prompt {
  color: var(--color-radiant);
  font-weight: 700;
  user-select: none;
  flex-shrink: 0;
}

.cmd-input__field {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  outline: none;
  caret-color: var(--color-radiant);
  min-width: 0;
}

.cmd-input__field::placeholder {
  color: var(--text-dim);
  opacity: 0.4;
}

.cmd-input__cursor {
  color: var(--color-radiant);
  font-size: 0.875rem;
  position: absolute;
  left: 44px;
  pointer-events: none;
}

.cmd-input__tick {
  color: var(--text-dim);
  font-size: 0.7rem;
  white-space: nowrap;
  flex-shrink: 0;
}

.tab-completion {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
}

.tab-completion__item {
  padding: 4px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: var(--font-mono);
}

.tab-completion__item:hover,
.tab-completion__item--active {
  background: var(--border-color);
  color: var(--color-ability);
}
</style>
