<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed } from 'vue'
import type { CombatLine, CombatLineType, Salience } from '~/utils/combatLog'

const props = defineProps<{
  events: CombatLine[]
}>()

const logEl = ref<HTMLElement>()
const pinned = ref(false)
const lastEvent = ref<CombatLine | null>(null)

const MAX_VISIBLE_EVENTS = 120

// ── Filtering ──────────────────────────────────────────────────
// A compact set of chips + a verbose/terse density toggle. `verbose`
// defaults ON so the log is a superset of the old flat stream (terse is an
// opt-in noise cut). Lines without a salience (system/chat/announcements)
// are always shown regardless of density.
type Filter = 'all' | 'combat' | 'me' | 'obj'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'combat', label: 'COMBAT' },
  { id: 'me', label: 'ME' },
  { id: 'obj', label: 'OBJ' },
]
const filter = ref<Filter>('all')
const verbose = ref(true)

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

// Terse mode hides only bystander chip / farming noise: explicit world-salience
// damage & gold. Kills, objectives, and anything about me/allies always stay.
function passesDensity(line: CombatLine): boolean {
  if (verbose.value) return true
  if (line.salience === 'world' && (line.type === 'damage' || line.type === 'gold')) return false
  return true
}

const filteredEvents = computed(() =>
  props.events.filter((l) => passesFilter(l) && passesDensity(l)),
)

const visibleEvents = computed(() => {
  const e = filteredEvents.value
  return e.length <= MAX_VISIBLE_EVENTS ? e : e.slice(-MAX_VISIBLE_EVENTS)
})

// ── Per-tick beats ─────────────────────────────────────────────
// Group consecutive same-tick lines into a "beat" with a single header, so the
// 4-second resolution reads as a discrete turn instead of a flat scroll that
// repeats the tick number on every line.
interface Beat {
  tick: number
  lines: CombatLine[]
}

const beats = computed<Beat[]>(() => {
  const out: Beat[] = []
  for (const line of visibleEvents.value) {
    const last = out[out.length - 1]
    if (last && last.tick === line.tick) last.lines.push(line)
    else out.push({ tick: line.tick, lines: [line] })
  }
  return out
})

function clock(tick: number): string {
  const s = tick * 4
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Scroll handling ────────────────────────────────────────────
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

watch([filter, verbose], () => nextTick(scrollToBottom))

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
  kill: 'border-l-dire',
  gold: 'border-l-gold',
  system: 'border-l-system',
  ability: 'border-l-ability',
  victory: 'border-l-gold',
  objective: 'border-l-zone',
}

function typeColor(type: CombatLineType): string {
  const map: Record<CombatLineType, string> = {
    damage: 'rgb(var(--color-damage))',
    healing: 'rgb(var(--color-healing))',
    kill: 'rgb(var(--color-dire))',
    gold: 'rgb(var(--color-gold))',
    system: 'rgb(var(--color-system))',
    ability: 'rgb(var(--color-ability))',
    victory: 'rgb(var(--color-gold))',
    objective: 'rgb(var(--color-zone))',
  }
  return map[type] ?? 'rgb(var(--text-primary))'
}

function typePrefix(type: CombatLineType): string {
  const map: Record<CombatLineType, string> = {
    damage: '[DAMAGE]',
    healing: '[HEAL]',
    kill: '[KILL]',
    gold: '[GOLD]',
    system: '[SYS]',
    ability: '[ABILITY]',
    victory: '[VICTORY]',
    objective: '[OBJ]',
  }
  return map[type] ?? ''
}

/** Per-line classes from salience — the text-MOBA equivalent of the camera
 * being centred on your hero: incoming-to-me is loudest, my actions calmer,
 * pure bystander chip dims out. */
function salienceClasses(s: Salience | undefined, type: CombatLineType): string[] {
  const out: string[] = []
  if (type === 'kill' || type === 'victory') out.push('font-bold')
  switch (s) {
    case 'mine-in':
      out.push('bg-dire/[0.07]', 'text-text-primary', 'font-semibold')
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
  return `${typePrefix(line.type)} Tick ${line.tick}: ${line.text}`
}
</script>

<template>
  <div class="relative flex h-full flex-col" data-testid="combat-log">
    <div aria-live="polite" class="sr-only">
      {{ lastEvent ? eventAriaLabel(lastEvent) : '' }}
    </div>

    <!-- Filter chips + density toggle -->
    <div
      class="flex shrink-0 items-center gap-1 border-b border-border bg-bg-secondary/60 px-2 py-0.5 text-[0.6rem]"
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
        @click="filter = f.id"
      >
        {{ f.label }}
      </button>
      <button
        class="ml-1 border px-1 py-px font-mono tracking-wider transition-colors"
        :class="verbose ? 'border-border text-text-dim' : 'border-ability text-ability'"
        data-testid="log-density-toggle"
        :title="verbose ? 'Verbose — click for terse' : 'Terse — click for verbose'"
        @click="verbose = !verbose"
      >
        {{ verbose ? '≡' : '─' }}
      </button>
    </div>

    <div
      v-if="pinned"
      class="absolute inset-x-0 top-5 z-[1] cursor-pointer border-b border-border bg-bg-secondary px-2 py-0.5 text-center text-[0.7rem] text-text-dim"
      @click="togglePin"
    >
      [scroll pinned — click to resume]
    </div>

    <div
      ref="logEl"
      class="flex-1 overflow-y-auto py-1 text-[0.8rem] leading-normal"
      @scroll="handleScroll"
    >
      <div v-for="beat in beats" :key="beat.tick" class="mb-0.5">
        <!-- Tick beat header -->
        <div
          class="sticky top-0 z-[1] flex items-center gap-1 bg-bg-panel/95 px-2 py-px text-[0.6rem] tracking-wider text-text-muted select-none"
        >
          <span class="text-border">──</span>
          <span class="font-bold">TICK {{ beat.tick }}</span>
          <span class="text-text-dim">· {{ clock(beat.tick) }}</span>
          <span class="flex-1 truncate text-right text-border">{{
            '─'.repeat(40)
          }}</span>
        </div>

        <div
          v-for="(event, i) in beat.lines"
          :key="`${beat.tick}-${i}`"
          data-testid="log-event"
          :aria-label="eventAriaLabel(event)"
          class="anim-fade-in-up border-l-2 border-l-transparent px-2 py-px t-mono-num hover:bg-white/[0.03]"
          :class="[borderColors[event.type], ...salienceClasses(event.salience, event.type)]"
          :style="{ animationDelay: `${Math.min(i, 8) * 35}ms` }"
        >
          <span
            v-if="event.salience === 'mine-in'"
            class="mr-1 text-[0.6rem] font-bold text-dire"
            >&#9656;YOU</span
          >
          <span
            class="mr-1 text-[0.65rem] font-bold"
            :class="
              event.type === 'kill' ? 'text-glow-dire' : event.type === 'gold' ? 'text-glow-gold' : ''
            "
            :style="{ color: typeColor(event.type) }"
            >{{ typePrefix(event.type) }}</span
          >
          <HeroAvatar
            v-if="event.type === 'kill' && event.killerHeroId"
            :hero-id="event.killerHeroId"
            :size="16"
            class="mr-1 inline-flex align-middle"
          />
          <span
            :class="event.type === 'kill' || event.type === 'victory' ? 'font-bold text-glow-sm' : ''"
            :style="{ color: typeColor(event.type) }"
            >{{ event.text }}</span
          >
          <HeroAvatar
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
      <div
        v-else-if="!beats.length"
        class="p-2 text-[0.75rem] text-text-dim"
      >
        &gt;_ no events match this filter
      </div>
    </div>
  </div>
</template>
