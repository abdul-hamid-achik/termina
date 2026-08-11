<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import { POSTURE_META, POSTURE_ORDER } from '~~/shared/constants/postures'
import { CAST } from '~~/shared/constants/cast'
import { heroPlaystyleTags } from '~~/shared/heroPlaystyle'
import type { TeamId } from '~~/shared/types/game'
import type { HeroPosture } from '~~/shared/types/hero'

const props = withDefaults(
  defineProps<{
    /** 'pick' = normal draft; 'ban' = ban phase (clicking bans, not picks). */
    mode?: 'pick' | 'ban'
    team: TeamId
    pickedHeroes?: Record<string, string>
    /** Heroes removed from the draft during the ban phase (unpickable). */
    bannedHeroes?: string[]
    teamRoster?: Array<{ playerId: string; name: string; heroId: string | null; team: TeamId }>
    timeRemaining?: number
    /** Whose turn it is in the snake draft (from the server's pick_turn message). */
    currentPicker?: { playerId: string; username: string } | null
    /** Server-authoritative pick deadline (epoch ms). Countdown derives from this. */
    pickDeadline?: number | null
    /** The local player's ID — CONFIRM is gated on it being their turn. */
    myPlayerId?: string | null
    /** Inline error notice (e.g. server rejected the pick). */
    errorMessage?: string | null
    /**
     * Player has never finished the tutorial — pre-selects a beginner hero so a
     * 15-second first draft can't end in an auto-random.
     */
    newPlayer?: boolean
  }>(),
  {
    mode: 'pick',
    pickedHeroes: () => ({}),
    bannedHeroes: () => [],
    teamRoster: () => [],
    timeRemaining: 30,
    currentPicker: null,
    pickDeadline: null,
    myPlayerId: null,
    errorMessage: null,
    newPlayer: false,
  },
)

const emit = defineEmits<{
  pick: [heroId: string]
  ban: [heroId: string]
  confirm: []
}>()

const isBanMode = computed(() => props.mode === 'ban')

const selectedHero = ref<string | null>(null)
const confirmed = ref(false)
// Fallback local countdown when no server deadline is available
const localCountdown = ref(props.timeRemaining)
// Clock tick to re-derive the deadline countdown; the deadline itself is the
// time source, so this can't drift from the server
const nowMs = ref(Date.now())

const countdown = computed(() => {
  if (props.pickDeadline != null) {
    return Math.max(0, Math.ceil((props.pickDeadline - nowMs.value) / 1000))
  }
  return localCountdown.value
})

const countdownClass = computed(() =>
  countdown.value <= 10
    ? 'text-audit text-glow-audit animate-pulse'
    : countdown.value <= 20
      ? 'text-warn text-glow'
      : 'text-text-primary text-glow-sm',
)

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  localCountdown.value = props.timeRemaining
  timer = setInterval(() => {
    nowMs.value = Date.now()
    localCountdown.value = Math.max(0, localCountdown.value - 1)
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

/**
 * Heroes whose whole kit is self- or single-target — no zone placement, no
 * positional setup — so a first-timer can play them with the four keys they
 * were just taught. Hand-authored here because `HeroDef` carries no difficulty
 * rating; the criterion is the ability `targetType` set, which is checked by
 * test rather than trusted.
 */
const BEGINNER_HERO_IDS: readonly string[] = ['kernel', 'echo', 'regex', 'mutex']

const heroList = computed(() =>
  HERO_IDS.map((id) => {
    const hero = HEROES[id]!
    const pickedBy = Object.entries(props.pickedHeroes).find(([, hid]) => hid === id)
    return {
      ...hero,
      picked: !!pickedBy,
      pickedByName: pickedBy?.[0] ?? null,
      banned: props.bannedHeroes.includes(id),
      beginner: BEGINNER_HERO_IDS.includes(id),
    }
  }),
)

const postureFilter = ref<HeroPosture | 'all'>('all')
const search = ref('')

/** Posture tabs, in the canonical order, limited to postures the roster has. */
const postureTabs = computed(() =>
  POSTURE_ORDER.filter((p) => heroList.value.some((h) => h.posture === p)).map((p) => ({
    posture: p,
    label: POSTURE_META[p].label,
  })),
)

const filteredHeroes = computed(() => {
  const q = search.value.trim().toLowerCase()
  return heroList.value.filter((h) => {
    if (postureFilter.value !== 'all' && h.posture !== postureFilter.value) return false
    if (!q) return true
    const op = CAST[h.id as HeroId]
    return (
      h.name.toLowerCase().includes(q) ||
      h.posture.toLowerCase().includes(q) ||
      h.role.includes(q) ||
      (op?.realName.toLowerCase().includes(q) ?? false)
    )
  })
})

const availableHeroes = computed(() => heroList.value.filter((h) => !h.picked && !h.banned))

/** First still-available beginner hero — the pre-selection for a new player. */
const recommendedHeroId = computed(
  () => availableHeroes.value.find((h) => h.beginner)?.id ?? availableHeroes.value[0]?.id ?? null,
)

// A first-timer facing 18 unfamiliar cards on a 15s clock usually times out into
// an auto-random. Start them on a forgiving hero they can still change. Never
// during the ban phase, where a pre-selection would arm a ban nobody chose —
// and `immediate` rather than `onMounted` so the first paint already carries the
// recommendation. The watch (not a one-off) matters because 10- and 6-player
// lobbies open on bans: the same component instance is re-used for the pick
// phase, so the only moment to seed it is that mode flip.
watch(
  isBanMode,
  (banning) => {
    if (!banning && props.newPlayer && !selectedHero.value) {
      selectedHero.value = recommendedHeroId.value
    }
  },
  { immediate: true },
)

const selectedHeroDef = computed(() => (selectedHero.value ? HEROES[selectedHero.value] : null))
// Kit-identity tags (Burst/Control/…) for the selected hero — same at-a-glance
// summary the /cast console + /lore cards show, brought to the draft.
const selectedPlaystyle = computed(() =>
  selectedHeroDef.value ? heroPlaystyleTags(selectedHeroDef.value) : [],
)

const chaffRoster = computed(() => props.teamRoster.filter((m) => m.team === 'chaff'))
const auditRoster = computed(() => props.teamRoster.filter((m) => m.team === 'audit'))

/** Whether the local player is the one the server expects to pick right now. */
const isMyTurn = computed(
  () => !!props.myPlayerId && props.currentPicker?.playerId === props.myPlayerId,
)

/** The local player's confirmed (or optimistic) hero pick, if any. */
const myPick = computed(() =>
  props.myPlayerId ? (props.pickedHeroes[props.myPlayerId] ?? null) : null,
)

const lockedIn = computed(() =>
  // Ban phase has no per-player lock — the turn advances server-side after each
  // ban. Pick phase gates on the confirm latch / the player's landed pick.
  isBanMode.value ? false : confirmed.value || !!myPick.value,
)

const canConfirm = computed(() => {
  if (!isMyTurn.value || !selectedHero.value) return false
  if (isBanMode.value) {
    const hero = heroList.value.find((h) => h.id === selectedHero.value)
    return !!hero && !hero.banned && !hero.picked
  }
  return !lockedIn.value
})

// New pick turn → clear the one-shot confirm latch. If our pick actually
// landed, `myPick` keeps the button disabled; if it was rejected out-of-turn,
// this lets the player pick again on their real turn.
watch(
  () => props.currentPicker?.playerId,
  () => {
    confirmed.value = false
  },
)

// Optimistic pick rolled back (server rejected it) → unlock CONFIRM
watch(myPick, (val) => {
  if (!val) confirmed.value = false
})

// Someone else took the highlighted hero while we waited for our turn — drop it
// so the detail panel stops describing a hero we can no longer have. Skipped
// once we're locked in, where the "picked" hero is our own.
watch(
  () => heroList.value.find((h) => h.id === selectedHero.value),
  (hero) => {
    if (!lockedIn.value && hero && (hero.picked || hero.banned)) selectedHero.value = null
  },
)

function selectHero(id: string) {
  if (lockedIn.value) return
  const hero = heroList.value.find((h) => h.id === id)
  if (hero?.picked) return
  if (isBanMode.value && hero?.banned) return
  selectedHero.value = id
}

/**
 * Highlight a random hero that is still legal to take. Prefers the filtered set
 * so "random carry" works, but falls back to the whole pool rather than
 * no-oping when the filter matches nothing available.
 */
function pickRandom() {
  if (lockedIn.value) return
  const fromFilter = filteredHeroes.value.filter((h) => !h.picked && !h.banned)
  const pool = fromFilter.length ? fromFilter : availableHeroes.value
  const hero = pool[Math.floor(Math.random() * pool.length)]
  if (hero) selectedHero.value = hero.id
}

function clearFilters() {
  postureFilter.value = 'all'
  search.value = ''
}

function confirmPick() {
  if (!canConfirm.value || !selectedHero.value) return
  if (isBanMode.value) {
    emit('ban', selectedHero.value)
    selectedHero.value = null
    return
  }
  confirmed.value = true
  emit('pick', selectedHero.value)
  emit('confirm')
}

function heroNameById(heroId: string | null): string {
  if (!heroId) return '...'
  return HEROES[heroId]?.name ?? heroId
}

function initialOf(name: string | undefined | null): string {
  return name?.trim().charAt(0).toUpperCase() || '·'
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-bg-primary p-2 sm:p-3" data-testid="hero-picker">
    <!-- TOP (desktop): full team panels side-by-side with VS + countdown -->
    <div class="mb-2 hidden gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr]">
      <!-- Chaff panel -->
      <div class="border border-border bg-bg-panel p-2 shadow-glow-chaff">
        <div class="t-h3 mb-1 text-center text-chaff text-glow-chaff">CHAFF</div>
        <div class="flex flex-col gap-0.5">
          <div
            v-for="(slot, i) in 5"
            :key="'chaff-' + i"
            class="flex items-center gap-1.5 px-1.5 py-0.5 text-[0.75rem]"
            :class="
              chaffRoster[i]?.heroId
                ? 'border-l-2 border-chaff text-chaff'
                : 'border-l-2 border-border text-text-dim'
            "
          >
            <span class="w-3 shrink-0 text-center font-bold opacity-50">{{ i + 1 }}</span>
            <HeroPortrait
              v-if="chaffRoster[i]?.heroId"
              :hero-id="chaffRoster[i]!.heroId!"
              :size="20"
            />
            <span class="min-w-0 flex-1 truncate font-mono">
              {{ chaffRoster[i]?.name ?? '---' }}
            </span>
            <span class="shrink-0 text-[0.65rem] font-bold uppercase">
              {{ heroNameById(chaffRoster[i]?.heroId ?? null) }}
            </span>
          </div>
        </div>
      </div>

      <!-- VS + countdown -->
      <div class="flex flex-col items-center justify-center gap-1 px-3">
        <span class="t-h2 text-text-muted tracking-[0.2em]">VS</span>
        <span class="t-display tabular-nums" :class="countdownClass">
          {{ countdown }}<span class="t-h3 ml-0.5 text-text-muted">s</span>
        </span>
        <span
          v-if="currentPicker"
          class="t-h3 max-w-[140px] truncate text-center text-text-dim"
          data-testid="pick-turn"
        >
          {{ currentPicker.username }} picking…
        </span>
      </div>

      <!-- Audit panel -->
      <div class="border border-border bg-bg-panel p-2 shadow-glow-audit">
        <div class="t-h3 mb-1 text-center text-audit text-glow-audit">AUDIT</div>
        <div class="flex flex-col gap-0.5">
          <div
            v-for="(slot, i) in 5"
            :key="'audit-' + i"
            class="flex items-center gap-1.5 px-1.5 py-0.5 text-[0.75rem]"
            :class="
              auditRoster[i]?.heroId
                ? 'border-l-2 border-audit text-audit'
                : 'border-l-2 border-border text-text-dim'
            "
          >
            <span class="w-3 shrink-0 text-center font-bold opacity-50">{{ i + 1 }}</span>
            <HeroPortrait
              v-if="auditRoster[i]?.heroId"
              :hero-id="auditRoster[i]!.heroId!"
              :size="20"
            />
            <span class="min-w-0 flex-1 truncate font-mono">
              {{ auditRoster[i]?.name ?? '---' }}
            </span>
            <span class="shrink-0 text-[0.65rem] font-bold uppercase">
              {{ heroNameById(auditRoster[i]?.heroId ?? null) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- TOP (mobile): compact one-line roster strip — initials/avatars + pick state -->
    <div class="mb-2 flex items-center justify-center gap-1 sm:hidden" data-testid="roster-strip">
      <div
        v-for="(slot, i) in 5"
        :key="'strip-chaff-' + i"
        class="flex h-7 w-7 shrink-0 items-center justify-center border text-[0.65rem] font-bold uppercase"
        :class="[
          chaffRoster[i]?.heroId ? 'border-chaff text-chaff' : 'border-border text-text-dim',
          currentPicker && chaffRoster[i]?.playerId === currentPicker.playerId
            ? 'border-ability shadow-glow-highlight'
            : '',
        ]"
        :title="chaffRoster[i]?.name"
      >
        <HeroPortrait v-if="chaffRoster[i]?.heroId" :hero-id="chaffRoster[i]!.heroId!" :size="22" />
        <span v-else>{{ initialOf(chaffRoster[i]?.name) }}</span>
      </div>
      <span class="shrink-0 px-1 text-[0.6rem] text-text-muted">vs</span>
      <div
        v-for="(slot, i) in 5"
        :key="'strip-audit-' + i"
        class="flex h-7 w-7 shrink-0 items-center justify-center border text-[0.65rem] font-bold uppercase"
        :class="[
          auditRoster[i]?.heroId ? 'border-audit text-audit' : 'border-border text-text-dim',
          currentPicker && auditRoster[i]?.playerId === currentPicker.playerId
            ? 'border-ability shadow-glow-highlight'
            : '',
        ]"
        :title="auditRoster[i]?.name"
      >
        <HeroPortrait v-if="auditRoster[i]?.heroId" :hero-id="auditRoster[i]!.heroId!" :size="22" />
        <span v-else>{{ initialOf(auditRoster[i]?.name) }}</span>
      </div>
    </div>

    <!-- Turn banner: prominent "your turn" vs "waiting on <name>" -->
    <div
      v-if="currentPicker"
      class="mb-2 border px-2 py-1.5 text-center text-[0.8rem] font-bold uppercase tracking-wide"
      :class="
        isMyTurn && !myPick
          ? 'border-chaff bg-chaff/10 text-chaff text-glow-chaff animate-pulse'
          : 'border-border bg-bg-panel text-text-dim normal-case font-normal'
      "
      data-testid="turn-banner"
      role="status"
      aria-live="polite"
    >
      <template v-if="isMyTurn && (isBanMode || !myPick)"
        ><span aria-hidden="true">&gt;&gt;</span> YOUR TURN TO {{ isBanMode ? 'BAN' : 'PICK' }}
        <span aria-hidden="true">&lt;&lt;</span></template
      >
      <template v-else-if="isMyTurn && myPick">pick locked in — waiting for server…</template>
      <template v-else
        >waiting: {{ currentPicker.username }} is {{ isBanMode ? 'banning' : 'picking' }}…</template
      >
    </div>

    <!-- The clock ends in an auto-random, which is invisible if all you see is a
         number counting down. Only shown on our own turn — someone else's
         deadline says nothing about ours. -->
    <div
      v-if="isMyTurn && !lockedIn"
      class="mb-2 text-center text-[0.7rem] text-text-dim"
      data-testid="auto-pick-hint"
    >
      auto-{{ isBanMode ? 'bans' : 'picks' }} a random hero in {{ countdown }}s
    </div>

    <!-- New players get a starting selection rather than a blank 18-card wall. -->
    <div
      v-if="newPlayer && !isBanMode && !lockedIn && recommendedHeroId"
      class="mb-2 border border-gold/40 bg-gold/5 px-2 py-1 text-center text-[0.7rem] text-gold"
      data-testid="beginner-recommendation"
    >
      first game? {{ heroNameById(recommendedHeroId) }} is a forgiving pick — confirm it, or choose
      your own
    </div>

    <!-- Inline error notice (server rejections, etc.) -->
    <div
      v-if="errorMessage"
      class="mb-2 border border-audit bg-audit/10 px-2 py-1 text-center text-[0.75rem] text-audit"
      data-testid="pick-error"
      role="alert"
      aria-live="assertive"
    >
      [ERR] {{ errorMessage }}
    </div>

    <!-- Filter bar: 18 cards on a 15s clock is unscannable without one. -->
    <div class="mb-2 flex flex-wrap items-center gap-1" data-testid="picker-filters">
      <button
        type="button"
        data-testid="posture-tab-all"
        :aria-pressed="postureFilter === 'all'"
        class="touch-target border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide transition-colors"
        :class="
          postureFilter === 'all'
            ? 'border-ability bg-ability/10 text-ability'
            : 'border-border text-text-dim hover:border-border-glow'
        "
        @click="postureFilter = 'all'"
      >
        All
      </button>
      <button
        v-for="tab in postureTabs"
        :key="tab.posture"
        type="button"
        :data-testid="'posture-tab-' + tab.posture"
        :aria-pressed="postureFilter === tab.posture"
        class="touch-target border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide transition-colors"
        :class="
          postureFilter === tab.posture
            ? 'border-ability bg-ability/10 text-ability'
            : 'border-border text-text-dim hover:border-border-glow'
        "
        @click="postureFilter = tab.posture"
      >
        {{ tab.label }}
      </button>
      <input
        v-model="search"
        type="search"
        data-testid="hero-search"
        placeholder="filter…"
        aria-label="Filter heroes by name or role"
        class="touch-target min-w-0 flex-1 border border-border bg-bg-panel px-1.5 py-0.5 font-mono text-[0.7rem] text-text-primary placeholder:text-text-muted focus:border-ability focus:outline-none"
      />
      <button
        type="button"
        data-testid="hero-random"
        :disabled="lockedIn"
        class="touch-target border border-border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-text-dim transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-35"
        @click="pickRandom"
      >
        [Random]
      </button>
      <span class="text-[0.6rem] tabular-nums text-text-muted" data-testid="hero-count">
        {{ filteredHeroes.length }}/{{ heroList.length }}
      </span>
    </div>

    <!-- MIDDLE: Compact hero grid (scrolls internally) -->
    <div class="min-h-0 flex-1 overflow-auto">
      <div
        v-if="!filteredHeroes.length"
        class="flex flex-col items-center gap-1 p-4 text-[0.75rem] text-text-dim"
        data-testid="hero-empty"
      >
        <span>no hero matches that filter</span>
        <button
          type="button"
          data-testid="hero-filter-clear"
          class="border border-border px-1.5 py-0.5 text-[0.65rem] uppercase text-text-dim hover:border-border-glow"
          @click="clearFilters"
        >
          [Clear]
        </button>
      </div>
      <!-- Each card's spoken label carries POSTURE, never `role`. carry/tank/mage
           is borrowed vocabulary that survives only for BotManager's route
           priority and itemBuilds' ROLE_BUILD_ORDERS; it stays in the text filter
           above so "tank" still finds Kernel, but it is never read out. -->
      <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
        <div
          v-for="hero in filteredHeroes"
          :key="hero.id"
          :data-testid="'hero-card-' + hero.id"
          role="button"
          :tabindex="hero.picked || hero.banned || lockedIn ? -1 : 0"
          :aria-pressed="selectedHero === hero.id"
          :aria-disabled="hero.picked || hero.banned || lockedIn ? 'true' : undefined"
          :aria-label="
            hero.banned
              ? `${hero.name}, banned`
              : hero.picked
                ? `${hero.name}, already picked`
                : `${hero.name}, ${hero.posture}${hero.beginner ? ', beginner friendly' : ''}`
          "
          :data-posture="hero.posture"
          class="relative cursor-pointer border border-border bg-bg-panel p-2 transition-all duration-150"
          :class="{
            'border-ability bloom-ability scale-[1.02]': selectedHero === hero.id && !lockedIn,
            'border-chaff bloom-chaff': lockedIn && selectedHero === hero.id,
            'cursor-not-allowed opacity-30': hero.picked || hero.banned,
            'hover:border-border-glow hover:scale-[1.02] hover:shadow-glow-highlight':
              !hero.picked && !hero.banned && selectedHero !== hero.id,
          }"
          @click="selectHero(hero.id)"
          @keydown.enter.prevent="selectHero(hero.id)"
          @keydown.space.prevent="selectHero(hero.id)"
        >
          <div class="flex items-center gap-1.5">
            <HeroPortrait :hero-id="hero.id" :size="32" />
            <div class="min-w-0 flex-1">
              <div class="mb-0.5 flex items-center gap-1">
                <span class="text-[0.65rem] font-bold uppercase tracking-wider text-chaff">{{
                  hero.posture
                }}</span>
                <span class="truncate text-[0.75rem] font-bold uppercase text-text-primary">{{
                  hero.name
                }}</span>
              </div>
              <div class="flex gap-1.5 text-[0.6rem] text-text-dim">
                <span>INTEG:{{ hero.baseStats.integ }}</span>
                <span>ATK:{{ hero.baseStats.attack }}</span>
                <span>DEF:{{ hero.baseStats.plate }}</span>
              </div>
              <div
                v-if="hero.beginner"
                class="mt-0.5 inline-block border border-gold/50 px-1 text-[0.55rem] uppercase tracking-wider text-gold"
                :data-testid="'beginner-badge-' + hero.id"
              >
                easy to learn
              </div>
            </div>
          </div>
          <div
            v-if="hero.picked"
            class="t-h3 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-audit text-glow-audit"
          >
            PICKED
          </div>
          <div
            v-else-if="hero.banned"
            class="t-h3 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-warn text-glow line-through"
          >
            BANNED
          </div>
        </div>
      </div>
    </div>

    <!-- BOTTOM: Selected hero details + countdown + confirm.
         Sticky on phones so CONFIRM never scrolls off-screen. -->
    <div
      class="sticky bottom-0 z-10 mt-2 flex flex-col items-stretch gap-2 border-t border-border bg-bg-primary pt-2 sm:static sm:flex-row sm:items-end sm:gap-3"
    >
      <div v-if="selectedHeroDef" class="anim-fade-in-up min-w-0 flex-1">
        <div class="t-h2 mb-1 text-ability text-glow-ability">
          {{ CAST[selectedHeroDef.id as HeroId].realName }}
          <span class="t-caption text-text-dim">`{{ selectedHeroDef.id }}`</span>
          <span class="t-caption uppercase tracking-wider text-chaff">{{
            selectedHeroDef.posture
          }}</span>
        </div>
        <!-- Kit identity at a glance — how this hero plays, beyond its role. -->
        <div
          v-if="selectedPlaystyle.length"
          class="mb-1.5 flex flex-wrap gap-1"
          data-testid="picker-playstyle"
        >
          <span
            v-for="t in selectedPlaystyle"
            :key="t"
            class="border border-ability/40 bg-ability/10 px-1 py-0.5 text-[0.55rem] uppercase tracking-wider text-ability"
          >
            {{ t }}
          </span>
        </div>
        <div
          v-if="selectedHeroDef.passive"
          class="mb-2 border-l-2 border-gold/40 pl-2 text-[0.66rem] leading-snug"
          data-testid="picker-passive"
        >
          <span class="font-bold text-gold">⟡ {{ selectedHeroDef.passive.name }}</span
          ><span class="text-text-dim"> — {{ selectedHeroDef.passive.description }}</span>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <div
            v-for="slot in ['q', 'w', 'e', 'r'] as const"
            :key="slot"
            class="border-l-2 border-ability/40 pl-2"
          >
            <div class="flex items-baseline gap-1.5 t-mono-num">
              <span class="t-h3 text-ability text-glow-ability">{{ slot.toUpperCase() }}</span>
              <span class="text-[0.7rem] font-bold uppercase text-text-primary">{{
                selectedHeroDef.abilities[slot].name
              }}</span>
            </div>
            <div class="t-caption flex gap-2 t-mono-num">
              <span
                >BW <span class="text-bw">{{ selectedHeroDef.abilities[slot].bwCost }}</span></span
              >
              <span
                >CD
                <span class="text-text-primary"
                  >{{ selectedHeroDef.abilities[slot].cooldownCycles }}t</span
                ></span
              >
            </div>
            <div
              class="mt-0.5 text-[0.62rem] leading-snug text-text-dim"
              :data-testid="`picker-ability-desc-${slot}`"
            >
              {{ selectedHeroDef.abilities[slot].description }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="min-w-0 flex-1 t-caption">
        &gt;_ select a handle to {{ isBanMode ? 'ban' : 'deploy' }}...
      </div>
      <div class="flex items-center justify-between gap-3 sm:justify-end">
        <!-- Mobile countdown (the desktop one lives in the VS column) -->
        <span
          class="t-h2 tabular-nums sm:hidden"
          :class="countdownClass"
          data-testid="mobile-countdown"
        >
          {{ countdown }}<span class="t-h3 ml-0.5 text-text-muted">s</span>
        </span>
        <AsciiButton
          :label="isBanMode ? 'BAN' : 'CONFIRM'"
          variant="primary"
          :disabled="!canConfirm"
          @click="confirmPick"
        />
      </div>
    </div>
  </div>
</template>
