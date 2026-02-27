<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import type { TeamId } from '~~/shared/types/game'

const props = withDefaults(
  defineProps<{
    team: TeamId
    pickedHeroes?: Record<string, string>
    teamRoster?: Array<{ playerId: string; name: string; heroId: string | null }>
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
</script>

<template>
  <div class="flex min-h-screen flex-col gap-3 bg-bg-primary p-4">
    <div class="flex items-center justify-between border-b border-border pb-2">
      <span class="text-base font-bold tracking-widest text-ability">SELECT YOUR HERO</span>
      <span
        class="text-xl font-bold text-text-primary"
        :class="{ 'animate-blink text-dire': countdown <= 10 }"
      >
        {{ countdown }}s
      </span>
    </div>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
      <div
        v-for="hero in heroList"
        :key="hero.id"
        class="relative cursor-pointer border border-border bg-bg-panel p-2.5 transition-all duration-150"
        :class="{
          'border-ability shadow-glow-ability': selectedHero === hero.id && !confirmed,
          'border-radiant shadow-[0_0_8px_rgba(46,204,113,0.3)]':
            confirmed && selectedHero === hero.id,
          'cursor-not-allowed opacity-30': hero.picked,
          'hover:border-border-glow': !hero.picked,
        }"
        @click="selectHero(hero.id)"
      >
        <div class="mb-1 flex items-center gap-1.5">
          <span class="text-[0.85rem] font-bold text-ability">{{
            ROLE_ICONS[hero.role] || '??'
          }}</span>
          <span class="text-[0.85rem] font-bold uppercase text-text-primary">{{ hero.name }}</span>
        </div>
        <div class="mb-1.5 text-[0.7rem] uppercase tracking-widest text-text-dim">
          {{ hero.role }}
        </div>
        <div class="flex gap-2 text-[0.65rem] text-text-dim">
          <span>HP:{{ hero.baseStats.hp }}</span>
          <span>MP:{{ hero.baseStats.mp }}</span>
          <span>ATK:{{ hero.baseStats.attack }}</span>
          <span>DEF:{{ hero.baseStats.defense }}</span>
        </div>
        <div
          v-if="hero.picked"
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[0.8rem] font-bold tracking-[0.2em] text-dire"
        >
          PICKED
        </div>
      </div>
    </div>

    <div v-if="selectedHeroDef" class="max-h-60 overflow-auto">
      <TerminalPanel :title="selectedHeroDef.name">
        <div class="flex flex-col gap-2">
          <div class="text-xs italic leading-normal text-text-dim">{{ selectedHeroDef.lore }}</div>
          <div class="flex flex-col gap-1">
            <div class="flex items-start gap-1.5 py-0.5 text-xs">
              <span class="w-4 shrink-0 font-bold text-ability">P</span>
              <span class="min-w-[120px] shrink-0 font-bold text-text-primary">{{
                selectedHeroDef.passive.name
              }}</span>
              <span class="text-text-dim">{{ selectedHeroDef.passive.description }}</span>
            </div>
            <div
              v-for="slot in ['q', 'w', 'e', 'r'] as const"
              :key="slot"
              class="flex items-start gap-1.5 py-0.5 text-xs"
            >
              <span class="w-4 shrink-0 font-bold text-ability">{{ slot.toUpperCase() }}</span>
              <span class="min-w-[120px] shrink-0 font-bold text-text-primary">{{
                selectedHeroDef.abilities[slot].name
              }}</span>
              <span class="text-text-dim">{{ selectedHeroDef.abilities[slot].description }}</span>
            </div>
          </div>
        </div>
      </TerminalPanel>
    </div>

    <div class="flex items-center justify-between border-t border-border pt-2">
      <div class="flex items-center gap-3 text-xs">
        <span class="font-bold text-text-dim">TEAM:</span>
        <span
          v-for="member in teamRoster"
          :key="member.playerId"
          :class="member.heroId ? 'text-radiant' : 'text-text-dim'"
        >
          {{ member.name }} {{ member.heroId ? `[${member.heroId}]` : '[...]' }}
        </span>
      </div>
      <AsciiButton
        label="CONFIRM"
        variant="primary"
        :disabled="!selectedHero || confirmed"
        @click="confirmPick"
      />
    </div>
  </div>
</template>
