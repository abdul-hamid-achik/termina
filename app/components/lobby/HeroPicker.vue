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
  }>(),
  {
    pickedHeroes: () => ({}),
    teamRoster: () => [],
    timeRemaining: 30,
  },
)

const emit = defineEmits<{
  pick: [heroId: string]
  confirm: []
}>()

const selectedHero = ref<string | null>(null)
const confirmed = ref(false)
const countdown = ref(props.timeRemaining)

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  countdown.value = props.timeRemaining
  timer = setInterval(() => {
    countdown.value = Math.max(0, countdown.value - 1)
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
  <div class="flex h-full flex-col bg-bg-primary p-3" data-testid="hero-picker">
    <!-- TOP: Team panels side-by-side -->
    <div class="mb-2 grid grid-cols-[1fr_auto_1fr] gap-2">
      <!-- Radiant panel -->
      <div class="border border-border bg-bg-panel p-2">
        <div class="mb-1 text-center text-[0.7rem] font-bold tracking-widest text-radiant">
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
      <div class="flex flex-col items-center justify-center gap-1 px-3">
        <span class="text-lg font-bold text-text-dim">VS</span>
        <span
          class="text-xl font-bold tabular-nums text-text-primary"
          :class="{ 'animate-blink text-dire': countdown <= 10 }"
        >
          {{ countdown }}s
        </span>
      </div>

      <!-- Dire panel -->
      <div class="border border-border bg-bg-panel p-2">
        <div class="mb-1 text-center text-[0.7rem] font-bold tracking-widest text-dire">DIRE</div>
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
      <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
        <div
          v-for="hero in heroList"
          :key="hero.id"
          :data-testid="'hero-card-' + hero.id"
          class="relative cursor-pointer border border-border bg-bg-panel p-1.5 transition-all duration-150"
          :class="{
            'border-ability shadow-glow-ability': selectedHero === hero.id && !confirmed,
            'border-radiant shadow-[0_0_8px_rgba(46,204,113,0.3)]':
              confirmed && selectedHero === hero.id,
            'cursor-not-allowed opacity-30': hero.picked,
            'hover:border-border-glow': !hero.picked,
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
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[0.7rem] font-bold tracking-[0.15em] text-dire"
          >
            PICKED
          </div>
        </div>
      </div>
    </div>

    <!-- BOTTOM: Selected hero details + confirm -->
    <div class="mt-2 flex items-end gap-3 border-t border-border pt-2">
      <div v-if="selectedHeroDef" class="min-w-0 flex-1">
        <div class="mb-1 text-[0.8rem] font-bold uppercase text-ability">
          {{ selectedHeroDef.name }}
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.65rem] text-text-dim">
          <span
            v-for="slot in ['q', 'w', 'e', 'r'] as const"
            :key="slot"
          >
            <span class="font-bold text-ability">{{ slot.toUpperCase() }}</span>
            {{ selectedHeroDef.abilities[slot].name }}
          </span>
        </div>
      </div>
      <div v-else class="min-w-0 flex-1 text-[0.75rem] text-text-dim">Select a hero...</div>
      <AsciiButton
        label="CONFIRM"
        variant="primary"
        :disabled="!selectedHero || confirmed"
        @click="confirmPick"
      />
    </div>
  </div>
</template>
