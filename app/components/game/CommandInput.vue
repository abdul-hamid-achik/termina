<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useCommands, validateCommand, buybackCostFor } from '~/composables/useCommands'
import type { GameContext, Suggestion } from '~/composables/useCommands'
import type { PlayerState, ZoneRuntimeState } from '~~/shared/types/game'
import type { ItemDef } from '~~/shared/types/items'
import { ZONE_MAP } from '~~/shared/constants/zones'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    placeholder?: string
    tickCountdown?: number
    player?: PlayerState | null
    visibleZones?: Record<string, ZoneRuntimeState>
    allPlayers?: Record<string, PlayerState>
    items?: Record<string, ItemDef>
    canAct?: boolean
    /** The command queued for the next tick (shown while waiting). */
    pendingCommand?: string | null
    /** Command typed while waiting — buffered client-side, sent next tick. */
    bufferedCommand?: string | null
    /** Current game tick, for cooldown-aware validation (buyback etc.). */
    tick?: number
  }>(),
  {
    placeholder: 'Enter command...',
    tickCountdown: 0,
    player: null,
    visibleZones: () => ({}),
    allPlayers: () => ({}),
    items: () => ({}),
    canAct: true,
    pendingCommand: null,
    bufferedCommand: null,
    tick: undefined,
  },
)

const emit = defineEmits<{
  submit: [command: string]
}>()

const { parse, autocomplete, addToHistory } = useCommands()

const input = ref('')
const inputEl = ref<HTMLInputElement>()
const history = ref<string[]>([])
const historyIndex = ref(-1)
const open = ref(false)
const selectedIndex = ref(0)
const listEl = ref<HTMLDivElement>()

const gameContext = computed<GameContext>(() => ({
  player: props.player ?? null,
  visibleZones: props.visibleZones,
  allPlayers: props.allPlayers,
  items: props.items,
  tick: props.tick,
}))

/**
 * Touch devices get no automatic focus — popping the soft keyboard over
 * the game on every tick is worse than requiring an explicit tap.
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(pointer: coarse)')?.matches) return true
  return (navigator.maxTouchPoints ?? 0) > 0
}

// Contextual suggestions from useCommands
const suggestions = computed<Suggestion[]>(() => {
  const val = input.value.trim()
  if (!val) {
    // Show all commands when empty and dropdown is open
    if (open.value) {
      return autocomplete(' ', gameContext.value).length
        ? autocomplete(' ', gameContext.value)
        : [
            { text: 'move', description: 'Move to a zone' },
            { text: 'attack', description: 'Attack a target' },
            { text: 'cast', description: 'Cast ability (q/w/e/r)' },
            { text: 'buy', description: 'Buy an item' },
            { text: 'sell', description: 'Sell an item' },
            { text: 'use', description: 'Use an active item' },
            { text: 'ward', description: 'Place a ward' },
            { text: 'scan', description: 'Scan nearby zone' },
            { text: 'status', description: 'Show hero status' },
            { text: 'map', description: 'Show map overview' },
            { text: 'chat', description: 'Send chat message' },
            { text: 'ping', description: 'Ping a zone' },
            { text: 'buyback', description: 'Pay gold to respawn instantly' },
            { text: 'surrender', description: 'Vote to forfeit (needs confirm)' },
          ]
    }
    return []
  }
  return autocomplete(val, gameContext.value).slice(0, 8)
})

// Inline validation preview
const preview = computed(() => {
  const val = input.value.trim()
  if (!val) return null

  const parts = val.split(/\s+/)
  const cmd = parts[0]?.toLowerCase()

  // If still typing just the command name, show hint
  const commands = [
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
    'buyback',
    'surrender',
  ]
  if (parts.length === 1 && commands.some((c) => c.startsWith(cmd!)) && !commands.includes(cmd!)) {
    return { type: 'dim' as const, text: `-- typing: ${cmd}...` }
  }

  // If command name complete but no arg, show usage hint
  if (parts.length === 1 && commands.includes(cmd!)) {
    const hints: Record<string, string> = {
      move: '-- move: specify a zone',
      attack: '-- attack: specify a target',
      cast: '-- cast: specify ability (q/w/e/r)',
      buy: '-- buy: specify an item',
      sell: '-- sell: specify an item',
      use: '-- use: specify an active item',
      ward: '-- ward: specify a zone',
      chat: '-- chat: specify channel (team/all)',
      ping: '-- ping: specify a zone',
      surrender: "-- surrender: type 'surrender confirm' to vote yes",
    }
    if (hints[cmd!]) return { type: 'dim' as const, text: hints[cmd!] }
  }

  // Parse to get validation (team makes base/fountain resolve to YOUR side)
  const { command, error } = parse(val, gameContext.value.player?.team)
  if (error) return { type: 'error' as const, text: `!! ${error}` }
  if (!command) return null

  // Pre-flight validation against game state (mirrors server rules)
  const validationError = validateCommand(command, gameContext.value)
  if (validationError) return { type: 'error' as const, text: `!! ${validationError}` }

  if (command.type === 'move') {
    const destZone = ZONE_MAP[command.zone]
    return { type: 'valid' as const, text: `>> Move to ${destZone?.name ?? command.zone}` }
  }

  if (command.type === 'attack') {
    const t = command.target
    const label =
      t.kind === 'hero'
        ? `hero ${t.name}`
        : t.kind === 'creep'
          ? `creep #${t.index}`
          : t.kind === 'tower'
            ? `tower in ${t.zone}`
            : 'self'
    return { type: 'valid' as const, text: `>> Attack ${label}` }
  }

  if (command.type === 'cast') {
    return {
      type: 'valid' as const,
      text: `>> Cast ${command.ability.toUpperCase()}${command.target ? ' on target' : ''}`,
    }
  }

  if (command.type === 'buy') {
    const item = props.items?.[command.item]
    if (item) {
      return { type: 'valid' as const, text: `>> Buy ${item.name} (-${item.cost}g)` }
    }
    return { type: 'valid' as const, text: `>> Buy ${command.item}` }
  }

  if (command.type === 'sell') {
    const item = props.items?.[command.item]
    return { type: 'valid' as const, text: `>> Sell ${item?.name ?? command.item}` }
  }

  if (command.type === 'use') {
    const item = props.items?.[command.item]
    return { type: 'valid' as const, text: `>> Use ${item?.name ?? command.item}` }
  }

  if (command.type === 'ward') {
    return { type: 'valid' as const, text: `>> Place ward in ${command.zone}` }
  }

  if (command.type === 'buyback') {
    const cost = props.player ? buybackCostFor(props.player) : null
    return { type: 'valid' as const, text: `>> Buyback${cost != null ? ` (-${cost}g)` : ''}` }
  }

  if (command.type === 'surrender') {
    return {
      type: 'valid' as const,
      text: command.vote === 'yes' ? '>> Vote YES to surrender' : '>> Retract surrender vote',
    }
  }

  // Simple commands
  const labels: Record<string, string> = {
    scan: '>> Scan nearby zone',
    status: '>> Show hero status',
    map: '>> Show map overview',
  }
  if (labels[command.type]) return { type: 'valid' as const, text: labels[command.type] }

  return { type: 'valid' as const, text: `>> ${command.type}` }
})

function handleSubmit() {
  const cmd = input.value.trim()
  if (!cmd) return

  // If dropdown open and item selected, accept it instead
  if (open.value && suggestions.value.length > 0) {
    acceptSuggestion(suggestions.value[selectedIndex.value]!)
    return
  }

  // Block submission of commands that would be rejected — in a one-action-
  // per-tick game a wasted action is the worst outcome. The preview line
  // already shows why it's invalid.
  if (preview.value?.type === 'error') {
    return
  }

  // Note: submission is NOT gated on canAct — while waiting for the next
  // tick the parent buffers the command and auto-sends it when the tick
  // arrives (shown via the bufferedCommand prop).
  emit('submit', cmd)
  addToHistory(cmd)
  history.value.unshift(cmd)
  if (history.value.length > 50) history.value.pop()
  historyIndex.value = -1
  input.value = ''
  open.value = false
  // Keep the prompt hot on desktop so players can pre-type the next command
  if (!isTouchDevice()) {
    nextTick(() => inputEl.value?.focus())
  }
}

function acceptSuggestion(suggestion: Suggestion) {
  const parts = input.value.trim().split(/\s+/)
  const suggestionParts = suggestion.text.split(/\s+/)

  // If suggestion is a complete command (multiple parts), replace entire input
  // This handles shortcuts like "cast r" being suggested when typing "cast r"
  if (suggestionParts.length > 1) {
    input.value = suggestion.text + ' '
  }
  // If only one part in input, this is a command completion — add space to continue
  else if (parts.length <= 1) {
    input.value = suggestion.text + ' '
  } else {
    // Replace the argument part
    parts[parts.length - 1] = suggestion.text
    input.value = parts.join(' ') + ' '
  }

  selectedIndex.value = 0
  // Keep open for further argument completion
  nextTick(() => {
    inputEl.value?.focus()
    // Close if no more suggestions
    if (suggestions.value.length === 0) {
      open.value = false
    }
  })
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (open.value && suggestions.value.length === 1) {
      // Single suggestion — only accept if it would actually change the input
      const lastToken = input.value.trim().split(/\s+/).pop()?.toLowerCase() ?? ''
      if (lastToken !== suggestions.value[0]!.text.toLowerCase()) {
        acceptSuggestion(suggestions.value[0]!)
        return
      }
      // Input already matches the suggestion — close dropdown and fall through to submit
      open.value = false
    }
    handleSubmit()
    return
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (open.value && suggestions.value.length > 0) {
      selectedIndex.value =
        selectedIndex.value > 0 ? selectedIndex.value - 1 : suggestions.value.length - 1
      scrollSelectedIntoView()
    } else if (!open.value) {
      if (historyIndex.value < history.value.length - 1) {
        historyIndex.value++
        input.value = history.value[historyIndex.value] ?? ''
      }
    }
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (open.value && suggestions.value.length > 0) {
      selectedIndex.value =
        selectedIndex.value < suggestions.value.length - 1 ? selectedIndex.value + 1 : 0
      scrollSelectedIntoView()
    } else if (!open.value) {
      if (historyIndex.value > 0) {
        historyIndex.value--
        input.value = history.value[historyIndex.value] ?? ''
      } else if (historyIndex.value === 0) {
        historyIndex.value = -1
        input.value = ''
      }
    }
    return
  }

  if (e.key === 'Tab') {
    e.preventDefault()
    if (open.value && suggestions.value.length > 0) {
      acceptSuggestion(suggestions.value[selectedIndex.value]!)
    } else if (suggestions.value.length > 0) {
      open.value = true
      selectedIndex.value = 0
    }
    return
  }

  if (e.key === 'Escape') {
    if (open.value) {
      open.value = false
    } else {
      input.value = ''
    }
    return
  }
}

function scrollSelectedIntoView() {
  nextTick(() => {
    const el = listEl.value?.querySelector('.cmd-selected')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

watch(input, () => {
  historyIndex.value = -1
  selectedIndex.value = 0
  // Auto-open when there are contextual suggestions
  if (input.value.trim().length > 0 && suggestions.value.length > 0) {
    open.value = true
  } else if (suggestions.value.length === 0) {
    open.value = false
  }
})

function handleSelect(suggestion: Suggestion) {
  acceptSuggestion(suggestion)
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

function highlightParts(text: string): Array<{ text: string; highlight: boolean }> {
  const val = input.value.trim().toLowerCase()
  const parts = val.split(/\s+/)
  const partial = parts.length > 1 ? parts[parts.length - 1]! : (parts[0] ?? '')
  if (!partial) return [{ text, highlight: false }]

  const idx = text.toLowerCase().indexOf(partial.toLowerCase())
  if (idx === -1) return [{ text, highlight: false }]

  const result: Array<{ text: string; highlight: boolean }> = []
  if (idx > 0) result.push({ text: text.slice(0, idx), highlight: false })
  result.push({ text: text.slice(idx, idx + partial.length), highlight: true })
  if (idx + partial.length < text.length)
    result.push({ text: text.slice(idx + partial.length), highlight: false })
  return result
}

onMounted(() => {
  // Don't auto-pop the soft keyboard over the game on touch devices
  if (!isTouchDevice()) {
    focusInput()
  }
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div
    class="cmd-input-wrapper relative cursor-text"
    data-testid="command-input"
    @click="focusInput"
  >
    <!-- Suggestions dropdown -->
    <div
      v-if="open && suggestions.length > 0"
      ref="listEl"
      class="absolute inset-x-0 bottom-full z-10 max-h-[200px] overflow-y-auto border border-border bg-bg-panel"
    >
      <div
        v-for="(s, i) in suggestions"
        :key="s.text"
        class="flex cursor-pointer items-center gap-2 px-3 py-1 font-mono text-[0.8rem]"
        :class="[
          i === selectedIndex
            ? 'cmd-selected bg-border text-ability'
            : 'text-text-primary hover:bg-border/50',
        ]"
        @click.stop="handleSelect(s)"
        @mouseenter="selectedIndex = i"
      >
        <span class="shrink-0"
          ><template v-for="(part, j) in highlightParts(s.text)" :key="j"
            ><span :class="{ 'text-ability': part.highlight }">{{ part.text }}</span></template
          ></span
        >
        <span v-if="s.description" class="ml-auto truncate text-[0.7rem] text-text-dim">
          {{ s.description }}
        </span>
      </div>
    </div>

    <!-- Inline validation preview -->
    <div
      v-if="preview"
      data-testid="command-preview"
      aria-live="polite"
      class="border-t border-border/50 px-3 py-0.5 font-mono text-[0.7rem]"
      :class="{
        'text-radiant': preview.type === 'valid',
        'text-dire': preview.type === 'error',
        'text-text-dim': preview.type === 'dim',
      }"
    >
      {{ preview.text }}
    </div>

    <!-- Buffered command notice — typed while waiting, sends next tick -->
    <div
      v-if="bufferedCommand"
      data-testid="buffered-command"
      aria-live="polite"
      class="border-t border-border/50 px-3 py-0.5 font-mono text-[0.7rem] text-gold"
    >
      [QUEUED] {{ bufferedCommand }} — sends next tick
    </div>

    <!-- Input row: never disabled, players can pre-type during the wait -->
    <div
      class="flex items-center gap-2 border-t border-border bg-bg-primary px-3 py-2"
      :class="{ 'opacity-50': disabled }"
    >
      <span class="shrink-0 font-bold text-radiant select-none">&gt;_</span>
      <input
        ref="inputEl"
        v-model="input"
        data-testid="command-input-field"
        aria-label="Command input"
        class="min-w-0 flex-1 border-none bg-transparent font-mono text-sm text-text-primary caret-radiant outline-none placeholder:text-text-dim placeholder:opacity-40"
        :placeholder="
          !canAct
            ? pendingCommand
              ? `Queued: ${pendingCommand} — resolves next tick`
              : 'Action sent — pre-type your next command'
            : placeholder
        "
        spellcheck="false"
        autocomplete="off"
        @keydown="handleKeydown"
      />
      <span
        v-if="!input && canAct"
        class="pointer-events-none absolute left-11 animate-blink text-sm text-radiant"
        >&#x2588;</span
      >
      <span
        v-if="tickCountdown > 0"
        class="shrink-0 whitespace-nowrap text-[0.7rem]"
        :class="canAct ? 'text-text-dim' : 'text-dire'"
      >
        <template v-if="canAct">Next tick in {{ (tickCountdown / 1000).toFixed(1) }}s</template>
        <template v-else>WAITING...</template>
      </span>
    </div>
  </div>
</template>
