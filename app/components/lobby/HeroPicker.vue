<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
  }>(),
  {
    pickedHeroes: () => ({}),
    teamRoster: () => [],
    timeRemaining: 30,
    currentPicker: null,
    pickDeadline: null,
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

const ROLE_ICONS: Record<string, string> = {
  carry: '>>',
  support: '++',
  assassin: '**',
  tank: '##',
  mage: '~~',
  offlaner: '<>',
}

function selectHero(id: string) {
  if (confirmed.value) return
  const hero = heroList.value.find((h) => h.id === id)
  if (hero?.picked) return
  selectedHero.value = id
}

function confirmPick() {
  if (!selectedHero.value || confirmed.value) return
  confirmed.value = true
  emit('pick', selectedHero.value)
  emit('confirm')
}

function heroNameById(heroId: string | null): string {
  if (!heroId) return '...'
  return HEROES[heroId]?.name ?? heroId
}
</script>

<template>
  <div class="flex h-full flex-col bg-bg-primary p-2 sm:p-3" data-testid="hero-picker">
    <!-- TOP: Team panels side-by-side; on phones, VS sits between stacked panels via grid -->
    <div class="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr]">
      <!-- Radiant panel -->
      <div class="border border-border bg-bg-panel p-2 shadow-glow-radiant">
        <div class="t-h3 mb-1 text-center text-radiant text-glow-radiant">
          RADIANT
        </div>
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
            <HeroAvatar v-if="radiantRoster[i]?.heroId" :hero-id="radiantRoster[i]!.heroId!" :size="20" />
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
      <div class="flex flex-row items-center justify-center gap-3 py-1 sm:flex-col sm:gap-1 sm:px-3 sm:py-0">
        <span class="t-h2 text-text-muted tracking-[0.2em]">VS</span>
        <span
          class="t-display tabular-nums"
          :class="
            countdown <= 10
              ? 'text-dire text-glow-dire animate-pulse'
              : countdown <= 20
                ? 'text-warn text-glow'
                : 'text-text-primary text-glow-sm'
          "
        >
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

    <!-- MIDDLE: Compact hero grid -->
    <div class="min-h-0 flex-1 overflow-auto">
      <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
        <div
          v-for="hero in heroList"
          :key="hero.id"
          :data-testid="'hero-card-' + hero.id"
          class="relative cursor-pointer border border-border bg-bg-panel p-2 transition-all duration-150"
          :class="{
            'border-ability bloom-ability scale-[1.02]': selectedHero === hero.id && !confirmed,
            'border-radiant bloom-radiant': confirmed && selectedHero === hero.id,
            'cursor-not-allowed opacity-30': hero.picked,
            'hover:border-border-glow hover:scale-[1.02] hover:shadow-glow-highlight': !hero.picked && selectedHero !== hero.id,
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

    <!-- BOTTOM: Selected hero details + confirm -->
    <div class="mt-2 flex flex-col items-stretch gap-3 border-t border-border pt-2 sm:flex-row sm:items-end">
      <div v-if="selectedHeroDef" class="anim-fade-in-up min-w-0 flex-1">
        <div class="t-h2 mb-1 text-ability text-glow-ability">
          {{ selectedHeroDef.name }}
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
              <span>MP <span class="text-mana">{{ selectedHeroDef.abilities[slot].manaCost }}</span></span>
              <span>CD <span class="text-text-primary">{{ selectedHeroDef.abilities[slot].cooldownTicks }}t</span></span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="min-w-0 flex-1 t-caption">&gt;_ select a hero to deploy...</div>
      <AsciiButton
        label="CONFIRM"
        variant="primary"
        :disabled="!selectedHero || confirmed"
        @click="confirmPick"
      />
    </div>
  </div>
</template>
