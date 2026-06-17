<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import type { TeamId } from '~~/shared/types/game'

const props = withDefaults(
  defineProps<{
    team: TeamId
    pickedHeroes?: Record<string, string>
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
  }>(),
  {
    pickedHeroes: () => ({}),
    teamRoster: () => [],
    timeRemaining: 30,
    currentPicker: null,
    pickDeadline: null,
    myPlayerId: null,
    errorMessage: null,
  },
)

const emit = defineEmits<{
  pick: [heroId: string]
  confirm: []
}>()

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
    ? 'text-dire text-glow-dire animate-pulse'
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

const heroList = computed(() =>
  HERO_IDS.map((id) => {
    const hero = HEROES[id]!
    const pickedBy = Object.entries(props.pickedHeroes).find(([, hid]) => hid === id)
    return {
      ...hero,
      picked: !!pickedBy,
      pickedByName: pickedBy?.[0] ?? null,
    }
  }),
)

const selectedHeroDef = computed(() => (selectedHero.value ? HEROES[selectedHero.value] : null))

const radiantRoster = computed(() => props.teamRoster.filter((m) => m.team === 'radiant'))
const direRoster = computed(() => props.teamRoster.filter((m) => m.team === 'dire'))

/** Whether the local player is the one the server expects to pick right now. */
const isMyTurn = computed(
  () => !!props.myPlayerId && props.currentPicker?.playerId === props.myPlayerId,
)

/** The local player's confirmed (or optimistic) hero pick, if any. */
const myPick = computed(() =>
  props.myPlayerId ? (props.pickedHeroes[props.myPlayerId] ?? null) : null,
)

const lockedIn = computed(() => confirmed.value || !!myPick.value)

const canConfirm = computed(() => isMyTurn.value && !!selectedHero.value && !lockedIn.value)

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

const ROLE_ICONS: Record<string, string> = {
  carry: '>>',
  support: '++',
  assassin: '**',
  tank: '##',
  mage: '~~',
  offlaner: '<>',
}

function selectHero(id: string) {
  if (lockedIn.value) return
  const hero = heroList.value.find((h) => h.id === id)
  if (hero?.picked) return
  selectedHero.value = id
}

function confirmPick() {
  if (!canConfirm.value || !selectedHero.value) return
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
      <!-- Radiant panel -->
      <div class="border border-border bg-bg-panel p-2 shadow-glow-radiant">
        <div class="t-h3 mb-1 text-center text-radiant text-glow-radiant">RADIANT</div>
        <div class="flex flex-col gap-0.5">
          <div
            v-for="(slot, i) in 5"
            :key="'rad-' + i"
            class="flex items-center gap-1.5 px-1.5 py-0.5 text-[0.75rem]"
            :class="
              radiantRoster[i]?.heroId
                ? 'border-l-2 border-radiant text-radiant'
                : 'border-l-2 border-border text-text-dim'
            "
          >
            <span class="w-3 shrink-0 text-center font-bold opacity-50">{{ i + 1 }}</span>
            <HeroAvatar
              v-if="radiantRoster[i]?.heroId"
              :hero-id="radiantRoster[i]!.heroId!"
              :size="20"
            />
            <span class="min-w-0 flex-1 truncate font-mono">
              {{ radiantRoster[i]?.name ?? '---' }}
            </span>
            <span class="shrink-0 text-[0.65rem] font-bold uppercase">
              {{ heroNameById(radiantRoster[i]?.heroId ?? null) }}
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

      <!-- Dire panel -->
      <div class="border border-border bg-bg-panel p-2 shadow-glow-dire">
        <div class="t-h3 mb-1 text-center text-dire text-glow-dire">DIRE</div>
        <div class="flex flex-col gap-0.5">
          <div
            v-for="(slot, i) in 5"
            :key="'dire-' + i"
            class="flex items-center gap-1.5 px-1.5 py-0.5 text-[0.75rem]"
            :class="
              direRoster[i]?.heroId
                ? 'border-l-2 border-dire text-dire'
                : 'border-l-2 border-border text-text-dim'
            "
          >
            <span class="w-3 shrink-0 text-center font-bold opacity-50">{{ i + 1 }}</span>
            <HeroAvatar v-if="direRoster[i]?.heroId" :hero-id="direRoster[i]!.heroId!" :size="20" />
            <span class="min-w-0 flex-1 truncate font-mono">
              {{ direRoster[i]?.name ?? '---' }}
            </span>
            <span class="shrink-0 text-[0.65rem] font-bold uppercase">
              {{ heroNameById(direRoster[i]?.heroId ?? null) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- TOP (mobile): compact one-line roster strip — initials/avatars + pick state -->
    <div class="mb-2 flex items-center justify-center gap-1 sm:hidden" data-testid="roster-strip">
      <div
        v-for="(slot, i) in 5"
        :key="'strip-rad-' + i"
        class="flex h-7 w-7 shrink-0 items-center justify-center border text-[0.65rem] font-bold uppercase"
        :class="[
          radiantRoster[i]?.heroId ? 'border-radiant text-radiant' : 'border-border text-text-dim',
          currentPicker && radiantRoster[i]?.playerId === currentPicker.playerId
            ? 'border-ability shadow-glow-highlight'
            : '',
        ]"
        :title="radiantRoster[i]?.name"
      >
        <HeroAvatar
          v-if="radiantRoster[i]?.heroId"
          :hero-id="radiantRoster[i]!.heroId!"
          :size="22"
        />
        <span v-else>{{ initialOf(radiantRoster[i]?.name) }}</span>
      </div>
      <span class="shrink-0 px-1 text-[0.6rem] text-text-muted">vs</span>
      <div
        v-for="(slot, i) in 5"
        :key="'strip-dire-' + i"
        class="flex h-7 w-7 shrink-0 items-center justify-center border text-[0.65rem] font-bold uppercase"
        :class="[
          direRoster[i]?.heroId ? 'border-dire text-dire' : 'border-border text-text-dim',
          currentPicker && direRoster[i]?.playerId === currentPicker.playerId
            ? 'border-ability shadow-glow-highlight'
            : '',
        ]"
        :title="direRoster[i]?.name"
      >
        <HeroAvatar v-if="direRoster[i]?.heroId" :hero-id="direRoster[i]!.heroId!" :size="22" />
        <span v-else>{{ initialOf(direRoster[i]?.name) }}</span>
      </div>
    </div>

    <!-- Turn banner: prominent "your turn" vs "waiting on <name>" -->
    <div
      v-if="currentPicker"
      class="mb-2 border px-2 py-1.5 text-center text-[0.8rem] font-bold uppercase tracking-wide"
      :class="
        isMyTurn && !myPick
          ? 'border-radiant bg-radiant/10 text-radiant text-glow-radiant animate-pulse'
          : 'border-border bg-bg-panel text-text-dim normal-case font-normal'
      "
      data-testid="turn-banner"
    >
      <template v-if="isMyTurn && !myPick">&gt;&gt; YOUR TURN TO PICK &lt;&lt;</template>
      <template v-else-if="isMyTurn && myPick">pick locked in — waiting for server…</template>
      <template v-else>waiting: {{ currentPicker.username }} is picking…</template>
    </div>

    <!-- Inline error notice (server rejections, etc.) -->
    <div
      v-if="errorMessage"
      class="mb-2 border border-dire bg-dire/10 px-2 py-1 text-center text-[0.75rem] text-dire"
      data-testid="pick-error"
    >
      [ERR] {{ errorMessage }}
    </div>

    <!-- MIDDLE: Compact hero grid (scrolls internally) -->
    <div class="min-h-0 flex-1 overflow-auto">
      <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
        <div
          v-for="hero in heroList"
          :key="hero.id"
          :data-testid="'hero-card-' + hero.id"
          class="relative cursor-pointer border border-border bg-bg-panel p-2 transition-all duration-150"
          :class="{
            'border-ability bloom-ability scale-[1.02]': selectedHero === hero.id && !lockedIn,
            'border-radiant bloom-radiant': lockedIn && selectedHero === hero.id,
            'cursor-not-allowed opacity-30': hero.picked,
            'hover:border-border-glow hover:scale-[1.02] hover:shadow-glow-highlight':
              !hero.picked && selectedHero !== hero.id,
          }"
          @click="selectHero(hero.id)"
        >
          <div class="flex items-center gap-1.5">
            <HeroAvatar :hero-id="hero.id" :size="32" />
            <div class="min-w-0 flex-1">
              <div class="mb-0.5 flex items-center gap-1">
                <span class="text-[0.75rem] font-bold text-ability">{{
                  ROLE_ICONS[hero.role] || '??'
                }}</span>
                <span class="truncate text-[0.75rem] font-bold uppercase text-text-primary">{{
                  hero.name
                }}</span>
              </div>
              <div class="flex gap-1.5 text-[0.6rem] text-text-dim">
                <span>HP:{{ hero.baseStats.hp }}</span>
                <span>ATK:{{ hero.baseStats.attack }}</span>
                <span>DEF:{{ hero.baseStats.defense }}</span>
              </div>
            </div>
          </div>
          <div
            v-if="hero.picked"
            class="t-h3 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-dire text-glow-dire"
          >
            PICKED
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
          {{ selectedHeroDef.name }}
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
                >MP
                <span class="text-mana">{{ selectedHeroDef.abilities[slot].manaCost }}</span></span
              >
              <span
                >CD
                <span class="text-text-primary"
                  >{{ selectedHeroDef.abilities[slot].cooldownTicks }}t</span
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
      <div v-else class="min-w-0 flex-1 t-caption">&gt;_ select a hero to deploy...</div>
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
          label="CONFIRM"
          variant="primary"
          :disabled="!canConfirm"
          @click="confirmPick"
        />
      </div>
    </div>
  </div>
</template>
