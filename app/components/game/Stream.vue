<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed } from 'vue'
import HeroPortrait from '~/components/avatars/HeroPortrait.vue'
import { buildTickStoryView, buildTickRecaps } from '~/utils/combatLog'
import type { CombatLine, CombatLineType, Salience } from '~/utils/combatLog'
import { formatTickClock } from '~/utils/gameClock'

const props = defineProps<{
  events: CombatLine[]
}>()

const logEl = ref<HTMLElement>()
const pinned = ref(false)
const lastEvent = ref<CombatLine | null>(null)

const MAX_VISIBLE_EVENTS = 120

// ── Filtering ──────────────────────────────────────────────────
// A compact set of chips + a story/verbose toggle. STORY is the default view:
// everyone's farm noise folds into one dim line per cycle and each cycle's lines
// are ordered by salience (your results first, kills/objectives loud). Verbose
// shows the raw line-per-event stream. Lines without a salience (system/chat/
// announcements) are always shown regardless of density.
type Filter = 'all' | 'combat' | 'me' | 'obj'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'combat', label: 'COMBAT' },
  { id: 'me', label: 'ME' },
  { id: 'obj', label: 'OBJ' },
]
const filter = ref<Filter>('all')
const verbose = ref(false)
// Per-cycle personal recap, ON by default: the whole point of a 4-second turn is
// that it is comprehensible in one read, and summing "84 + 25 + 22" by eye every
// four seconds is what makes players stop reading the feed altogether.
const recap = ref(true)

const COMBAT_TYPES: CombatLineType[] = ['damage', 'healing', 'kill', 'ability']
const OBJ_TYPES: CombatLineType[] = ['objective', 'victory']

function passesFilter(line: CombatLine): boolean {
  // System/meta lines with no salience (chat, [ERROR], [PING], announcements,
  // the connection notice) are always shown — they must never be filtered away.
  if (line.type === 'system' && line.salience === undefined) return true
  switch (filter.value) {
    case 'combat':
      return COMBAT_TYPES.includes(line.type)
    case 'me':
      return line.salience === 'mine-in' || line.salience === 'mine-out'
    case 'obj':
      return OBJ_TYPES.includes(line.type) || line.type === 'kill'
    default:
      return true
  }
}

const filteredEvents = computed(() => {
  const source = verbose.value ? props.events : buildTickStoryView(props.events)
  return source.filter(passesFilter)
})

const visibleEvents = computed(() => {
  const e = filteredEvents.value
  return e.length <= MAX_VISIBLE_EVENTS ? e : e.slice(-MAX_VISIBLE_EVENTS)
})

// Built from the UNFILTERED stream: what a cycle did to you must not change
// because a filter chip is active or the render cap dropped an early line.
const recapByTick = computed(() => buildTickRecaps(props.events))

// ── Per-cycle beats ─────────────────────────────────────────────
// Group consecutive same-cycle lines into a "beat" with a single header, so the
// 4-second resolution reads as a discrete turn instead of a flat scroll that
// repeats the cycle number on every line.
interface Beat {
  cycle: number
  lines: CombatLine[]
}

const beats = computed<Beat[]>(() => {
  const out: Beat[] = []
  for (const line of visibleEvents.value) {
    const last = out[out.length - 1]
    if (last && last.cycle === line.cycle) last.lines.push(line)
    else out.push({ cycle: line.cycle, lines: [line] })
  }
  return out
})

function clock(cycle: number): string {
  return formatTickClock(cycle)
}

// ── Scroll handling ────────────────────────────────────────────
function scrollToBottom() {
  if (logEl.value && !pinned.value) {
    logEl.value.scrollTop = logEl.value.scrollHeight
  }
}

// Watch the ARRAY, not its length: the store caps events at 200, so length
// saturates mid-game and a length-based watch silently stops firing — the
// "auto-scroll died" bug. The parent recomputes the array every cycle, so the
// reference changes whenever content can have changed.
watch(
  () => props.events,
  (events) => {
    const last = events[events.length - 1]
    if (last && last !== lastEvent.value) lastEvent.value = last
    nextTick(scrollToBottom)
  },
)

watch([filter, verbose, recap], () => nextTick(scrollToBottom))

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

// ── Styling ────────────────────────────────────────────────────
const borderColors: Record<CombatLineType, string> = {
  damage: 'border-l-damage',
  healing: 'border-l-healing',
  kill: 'border-l-audit',
  scrip: 'border-l-gold',
  system: 'border-l-system',
  ability: 'border-l-ability',
  victory: 'border-l-gold',
  objective: 'border-l-zone',
  farm: 'border-l-transparent',
  rig: 'border-l-ability',
}

function typeColor(type: CombatLineType): string {
  const map: Record<CombatLineType, string> = {
    damage: 'rgb(var(--color-damage))',
    healing: 'rgb(var(--color-healing))',
    kill: 'rgb(var(--color-audit))',
    scrip: 'rgb(var(--color-gold))',
    system: 'rgb(var(--color-system))',
    ability: 'rgb(var(--color-ability))',
    victory: 'rgb(var(--color-gold))',
    objective: 'rgb(var(--color-zone))',
    farm: 'rgb(var(--text-dim))',
    rig: 'rgb(var(--color-ability))',
  }
  return map[type] ?? 'rgb(var(--text-primary))'
}

function typePrefix(type: CombatLineType): string {
  const map: Record<CombatLineType, string> = {
    damage: '[DAMAGE]',
    healing: '[HEAL]',
    kill: '[KILL]',
    scrip: '[SCRIP]',
    system: '[SYS]',
    ability: '[ABILITY]',
    victory: '[VICTORY]',
    objective: '[OBJ]',
    farm: '·',
    rig: '>',
  }
  return map[type] ?? ''
}

/**
 * Type → weight tier. Nine line types used to render at exactly two weights —
 * kill/victory loud, the other seven identical — so a hero death, a level-up, a
 * blocked spell and a wave's chip damage all carried the same emphasis.
 * Headline = a life or the match changed; notable = a power or map swing;
 * everything else stays at the reading weight.
 */
const emphasisByType: Record<CombatLineType, string> = {
  kill: 'font-bold text-glow-sm',
  victory: 'font-bold text-glow-sm',
  objective: 'font-semibold',
  rig: 'font-semibold',
  ability: '',
  damage: '',
  healing: '',
  scrip: '',
  system: '',
  farm: '',
}

/** Per-line classes from salience — the text-MOBA equivalent of the camera
 * being centred on your hero: incoming-to-me is loudest, my actions calmer,
 * pure bystander chip dims out. */
function salienceClasses(s: Salience | undefined, type: CombatLineType): string[] {
  const out: string[] = []
  if (type === 'kill' || type === 'victory') out.push('font-bold')
  else if (type === 'objective') out.push('font-semibold')
  switch (s) {
    case 'mine-in':
      out.push('bg-audit/[0.07]', 'text-text-primary', 'font-semibold')
      break
    case 'mine-out':
      out.push('bg-self/[0.05]', 'text-text-primary')
      break
    case 'world':
      if (type !== 'kill' && type !== 'victory' && type !== 'objective') out.push('opacity-60')
      break
    default:
      break
  }
  return out
}

function eventAriaLabel(line: CombatLine): string {
  return `${typePrefix(line.type)} Cycle ${line.cycle}: ${line.text}`
}
</script>

<template>
  <div class="relative flex h-full flex-col" data-testid="combat-log">
    <div aria-live="polite" class="sr-only">
      {{ lastEvent ? eventAriaLabel(lastEvent) : '' }}
    </div>

    <!-- Filter chips + density toggle. Fixed height because the pinned-scroll
         banner below is absolutely positioned to sit flush under this row; a
         row that grows with its type would slide under the banner. -->
    <div
      class="flex h-6 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary/60 px-2 t-hud-xs"
    >
      <span class="mr-auto font-bold tracking-wider text-text-dim">&gt;_ FEED</span>
      <button
        v-for="f in FILTERS"
        :key="f.id"
        class="border px-1 py-px font-mono tracking-wider transition-colors"
        :class="
          filter === f.id
            ? 'border-ability text-ability'
            : 'border-transparent text-text-muted hover:text-text-dim'
        "
        :data-testid="`log-filter-${f.id}`"
        :aria-pressed="filter === f.id"
        @click="filter = f.id"
      >
        {{ f.label }}
      </button>
      <button
        class="ml-1 border px-1 py-px font-mono tracking-wider transition-colors"
        :class="recap ? 'border-ability text-ability' : 'border-border text-text-dim'"
        data-testid="log-recap-toggle"
        :title="
          recap ? 'Per-cycle recap on — click to hide' : 'Per-cycle recap off — click to show'
        "
        :aria-label="recap ? 'Hide the per-cycle damage recap' : 'Show the per-cycle damage recap'"
        :aria-pressed="recap"
        @click="recap = !recap"
      >
        Σ
      </button>
      <button
        class="border px-1 py-px font-mono tracking-wider transition-colors"
        :class="verbose ? 'border-border text-text-dim' : 'border-ability text-ability'"
        data-testid="log-density-toggle"
        :title="verbose ? 'Verbose — click for terse' : 'Terse — click for verbose'"
        :aria-label="
          verbose ? 'Switch combat log to terse density' : 'Switch combat log to verbose density'
        "
        :aria-pressed="verbose"
        @click="verbose = !verbose"
      >
        {{ verbose ? '≡' : '─' }}
      </button>
    </div>

    <button
      v-if="pinned"
      type="button"
      class="absolute inset-x-0 top-6 z-[1] cursor-pointer border-b border-border bg-bg-secondary px-2 py-0.5 text-center t-hud-sm text-text-dim"
      @click="togglePin"
    >
      [scroll pinned — click to resume]
    </button>

    <div
      ref="logEl"
      class="flex-1 overflow-y-auto py-1 text-[0.8rem] leading-normal"
      @scroll="handleScroll"
    >
      <div v-for="beat in beats" :key="beat.cycle" class="mb-0.5">
        <!-- Cycle beat header. The recap rides INSIDE the sticky block so the
             turn's bottom line stays on screen while its detail scrolls away. -->
        <div class="sticky top-0 z-[1] bg-bg-panel/95 select-none">
          <div class="flex items-center gap-1 px-2 py-px t-hud-xs tracking-wider text-text-muted">
            <span class="text-border">──</span>
            <span class="font-bold">CYCLE {{ beat.cycle }}</span>
            <span class="text-text-dim">· {{ clock(beat.cycle) }}</span>
            <span class="flex-1 truncate text-right text-border">{{ '─'.repeat(40) }}</span>
          </div>
          <div
            v-if="recap && recapByTick.get(beat.cycle)"
            class="flex flex-wrap items-baseline gap-x-2 px-2 pb-px t-hud-sm t-mono-num"
            data-testid="tick-recap"
            :aria-label="`Cycle ${beat.cycle} recap: ${recapByTick.get(beat.cycle)!.text}`"
          >
            <span v-if="recapByTick.get(beat.cycle)!.takenText" class="font-semibold text-audit">
              {{ recapByTick.get(beat.cycle)!.takenText }}
            </span>
            <span v-if="recapByTick.get(beat.cycle)!.dealtText" class="text-self">
              {{ recapByTick.get(beat.cycle)!.dealtText }}
            </span>
          </div>
        </div>

        <div
          v-for="(event, i) in beat.lines"
          :key="`${beat.cycle}-${i}`"
          data-testid="log-event"
          :aria-label="eventAriaLabel(event)"
          class="anim-fade-in-up border-l-2 border-l-transparent px-2 py-px t-mono-num hover:bg-white/[0.03]"
          :class="[borderColors[event.type], ...salienceClasses(event.salience, event.type)]"
          :style="{ animationDelay: `${Math.min(i, 8) * 35}ms` }"
        >
          <span v-if="event.salience === 'mine-in'" class="mr-1 t-hud-xs font-bold text-audit"
            >&#9656;YOU</span
          >
          <span
            v-else-if="event.salience === 'mine-out' && event.type !== 'farm'"
            class="mr-1 t-hud-xs font-bold text-self"
            >&#9656;YOU</span
          >
          <span
            class="mr-1 t-hud-xs font-bold"
            :class="
              event.type === 'kill'
                ? 'text-glow-audit'
                : event.type === 'scrip'
                  ? 'text-glow-gold'
                  : ''
            "
            :style="{ color: typeColor(event.type) }"
            >{{ typePrefix(event.type) }}</span
          >
          <HeroPortrait
            v-if="event.type === 'kill' && event.killerHeroId"
            :hero-id="event.killerHeroId"
            :size="16"
            class="mr-1 inline-flex align-middle"
          />
          <span :class="emphasisByType[event.type]" :style="{ color: typeColor(event.type) }">{{
            event.text
          }}</span>
          <HeroPortrait
            v-if="event.type === 'kill' && event.victimHeroId"
            :hero-id="event.victimHeroId"
            :size="16"
            class="ml-1 inline-flex align-middle"
          />
        </div>
      </div>

      <div v-if="!events.length" class="p-2 text-[0.8rem] text-text-dim">
        &gt;_ awaiting events...
      </div>
      <div v-else-if="!beats.length" class="p-2 t-hud-xs text-text-dim">
        &gt;_ no events match this filter
      </div>
    </div>
  </div>
</template>
