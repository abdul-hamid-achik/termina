<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useCommands, validateCommand, buybackCostFor, SHORTCUTS } from '~/composables/useCommands'
import type { GameContext, Suggestion } from '~/composables/useCommands'
import type {
  PlayerState,
  ZoneRuntimeState,
  GameMode,
  NeutralUnitState,
  WaveUnitState,
} from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import type { ItemDef } from '~~/shared/types/items'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { pathDistance } from '~~/shared/pathfinding'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    placeholder?: string
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
    /**
     * Game mode. Needed because this component runs its OWN pre-flight
     * validation and refuses to submit what it judges invalid — so any rule that
     * varies by mode (the tutorial's surrender exemption) must be visible here
     * too, or the terminal silently swallows a command the server would accept.
     */
    mode?: GameMode
    /**
     * The GLOBAL neutrals array (not zone-filtered) — `neutral:<index>` is a
     * global index. Deliberately has no default: validateCommand treats a
     * PRESENT array as ground truth, and an empty one would make an unbound
     * instance reject every legal neutral target.
     */
    neutrals?: NeutralUnitState[]
    /**
     * Lane waves, for `attack wave:<i>` autocomplete and pre-flight. Same
     * no-default rule as `neutrals`: validateCommand treats a PRESENT array as
     * ground truth, so an empty default would make an unbound instance reject
     * every legal wave target.
     */
    waves?: WaveUnitState[]
  }>(),
  {
    placeholder: 'Enter command...',
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
// Combobox ARIA wiring: the input owns the listbox and points at the active
// option so screen readers announce suggestions + arrow-key navigation.
const LISTBOX_ID = 'cmd-suggestion-listbox'

const gameContext = computed<GameContext>(() => ({
  player: props.player ?? null,
  visibleZones: props.visibleZones,
  allPlayers: props.allPlayers,
  items: props.items,
  tick: props.tick,
  mode: props.mode,
  neutrals: props.neutrals,
  waves: props.waves,
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
            { text: 'help', description: 'List all commands + the goal' },
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

/**
 * Human-readable name for an attack target in the preview line.
 *
 * Exhaustive on purpose: the previous ternary chain fell through to 'self' for
 * anything it did not name, so when `tenant` and `neutral:<i>` became parseable
 * the prompt confirmed them as ">> Attack self". The `never` assignment makes
 * TypeScript fail the build if a new TargetRef kind is added without a label,
 * rather than silently mislabelling it.
 */
function attackTargetLabel(t: TargetRef): string {
  switch (t.kind) {
    case 'hero':
      return `hero ${t.name}`
    case 'wave':
      return `wave #${t.index}`
    case 'neutral':
      return `neutral #${t.index}`
    case 'ice':
      return `ice in ${t.zone}`
    case 'tenant':
      return 'Tenant'
    case 'ancient':
      return 'the enemy Mainframe'
    case 'zone':
      return `everything in ${t.zone}`
    case 'self':
      return 'self'
    default: {
      const exhaustive: never = t
      return String((exhaustive as { kind?: string }).kind ?? 'target')
    }
  }
}

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
    'burn',
    'cast',
    'use',
    'buy',
    'sell',
    'ward',
    'scan',
    'status',
    'map',
    'help',
    'missing',
    'chat',
    'ping',
    'buyback',
    'surrender',
  ]
  // q/w/e/r are whole commands (`cast q`…), not a half-typed `ward`/`cache` —
  // preview the cast they perform so the shortcut's effect is visible before
  // Enter, rather than a hint pointing at the command that used to hijack it.
  const isCastShortcut = SHORTCUTS[cmd!]?.startsWith('cast ') ?? false
  if (
    parts.length === 1 &&
    !isCastShortcut &&
    commands.some((c) => c.startsWith(cmd!)) &&
    !commands.includes(cmd!)
  ) {
    return { type: 'dim' as const, text: `-- typing: ${cmd}...` }
  }

  // If command name complete but no arg, show usage hint
  if (parts.length === 1 && commands.includes(cmd!)) {
    const hints: Record<string, string> = {
      move: '-- move: specify a zone',
      attack: '-- attack: hits the nearest enemy, or specify a target',
      burn: '-- burn: burns the lowest-HP allied wave, or specify wave:N',
      cast: '-- cast: specify ability (q/w/e/r)',
      buy: '-- buy: specify an item',
      sell: '-- sell: specify an item',
      use: '-- use: an active item (offensive ones auto-hit the nearest enemy)',
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
    // Auto-path: show the travel time so a cross-map order reads as a plan.
    const zones = props.visibleZones ?? {}
    const hasZones = Object.keys(zones).length > 0
    const hops = props.player
      ? pathDistance(props.player.zone, command.zone, hasZones ? (id) => !!zones[id] : undefined)
      : 0
    const eta = hops > 1 ? ` (${hops} ticks)` : ''
    return { type: 'valid' as const, text: `>> Move to ${destZone?.name ?? command.zone}${eta}` }
  }

  if (command.type === 'attack') {
    return { type: 'valid' as const, text: `>> Attack ${attackTargetLabel(command.target)}` }
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

  if (command.type === 'missing') {
    return { type: 'valid' as const, text: `>> Alert team: ${command.enemyId} missing` }
  }

  // Simple commands
  const labels: Record<string, string> = {
    scan: '>> Scan nearby zone',
    status: '>> Show hero status',
    map: '>> Show map overview',
    help: '>> List all commands + the goal',
  }
  if (labels[command.type]) return { type: 'valid' as const, text: labels[command.type] }

  return { type: 'valid' as const, text: `>> ${command.type}` }
})

function handleSubmit() {
  const cmd = input.value.trim()
  if (!cmd) return

  if (open.value && suggestions.value.length > 0) {
    const typed = cmd.toLowerCase()
    const isNoop = (s: Suggestion) => completionFor(s).toLowerCase() === typed
    // Enter must never re-fill the input with what is already there: `cast q`
    // (the tutorial's literal instruction), `talent 10 left` and `surrender
    // confirm` are each their own only suggestion, so auto-accepting looped
    // forever and they could never be submitted. And when the typed text IS a
    // suggestion (`w`, `r`), the player meant that one — not the longer command
    // that merely starts with it (`ward`, `cache`), which hijacked two ability
    // shortcuts including the ultimate.
    // An explicitly highlighted suggestion (arrow keys / hover) always wins:
    // that is the only way to reach the neighbour the guard skips past.
    const accept =
      selectedIndex.value > 0
        ? !isNoop(suggestions.value[selectedIndex.value]!)
        : !suggestions.value.some(isNoop)
    if (accept) {
      acceptSuggestion(suggestions.value[selectedIndex.value]!)
      return
    }
    open.value = false
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

/**
 * The input this suggestion would produce if accepted. Enter compares it
 * against what is already typed, so a completion that changes nothing can be
 * recognised as a no-op instead of being applied forever.
 */
function completionFor(suggestion: Suggestion): string {
  const parts = input.value.trim().split(/\s+/)
  const suggestionParts = suggestion.text.split(/\s+/)
  // A multi-part suggestion is a complete command (e.g. "cast r" while typing
  // "cast r"), and a single-part input is a command completion — both replace
  // the whole input. Otherwise only the argument being typed is replaced.
  if (suggestionParts.length > 1 || parts.length <= 1) return suggestion.text
  parts[parts.length - 1] = suggestion.text
  return parts.join(' ')
}

function acceptSuggestion(suggestion: Suggestion) {
  input.value = completionFor(suggestion) + ' '

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
    } else if (input.value) {
      input.value = ''
    } else {
      // Nothing left to clear, so hand the keyboard back to the game. Every
      // advertised hotkey (S, Q/W/E/R, 1-6, arrows) is deliberately suppressed
      // while this input has focus — and the prompt auto-focuses on mount and
      // after every send — so without an explicit release they are unreachable.
      inputEl.value?.blur()
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

// Esc blurs the prompt so the in-game hotkeys become reachable; this is the way
// back in, so a player without a mouse is not locked out of typing. Routed from
// GameScreen's '/' handler.
defineExpose({ focus: focusInput })

/**
 * Typing mode vs keyboard mode. The two behave completely differently — while
 * the prompt has focus every in-game hotkey is swallowed as text — so the
 * prompt harden names the mode the player is actually in instead of always
 * showing `>_`.
 */
const focused = ref(false)
const promptGlyph = computed(() => (focused.value ? '>_' : '[KEYS]'))
const promptTitle = computed(() =>
  focused.value
    ? 'Typing — hotkeys are off. Press Esc on an empty prompt to release the keyboard.'
    : 'Keyboard mode — S, Q/W/E/R, 1-6 and arrows act on the game. Click here to type.',
)

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
      :id="LISTBOX_ID"
      ref="listEl"
      role="listbox"
      aria-label="Command suggestions"
      class="absolute inset-x-0 bottom-full z-10 max-h-[200px] overflow-y-auto border border-border bg-bg-panel"
    >
      <div
        v-for="(s, i) in suggestions"
        :id="`cmd-opt-${i}`"
        :key="s.text"
        role="option"
        :aria-selected="i === selectedIndex"
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
        'text-chaff': preview.type === 'valid',
        'text-audit': preview.type === 'error',
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
      <span
        data-testid="prompt-harden"
        class="shrink-0 font-mono font-bold select-none"
        :class="focused ? 'text-chaff' : 'text-text-dim'"
        :title="promptTitle"
        >{{ promptGlyph }}</span
      >
      <input
        ref="inputEl"
        v-model="input"
        data-testid="command-input-field"
        aria-label="Command input"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="open && suggestions.length > 0"
        :aria-controls="LISTBOX_ID"
        :aria-activedescendant="
          open && suggestions.length > 0 ? `cmd-opt-${selectedIndex}` : undefined
        "
        class="min-w-0 flex-1 border-none bg-transparent font-mono text-sm text-text-primary caret-chaff outline-none placeholder:text-text-dim placeholder:opacity-40"
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
        @focus="focused = true"
        @blur="focused = false"
      />
      <!-- The caret is drawn only in typing mode: in keyboard mode it would
           promise that the next letter lands in the box, when S opens the shop.
           It is also positioned for the narrow `>_` harden. -->
      <span
        v-if="!input && canAct && focused"
        class="pointer-events-none absolute left-11 animate-blink text-sm text-chaff"
        >&#x2588;</span
      >
      <!-- No countdown here — the combat log's theater header is the game's
           single tick clock (four duplicate countdowns was a legibility bug). -->
    </div>
  </div>
</template>
