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
  HERO_IDS.map(id => {
    const hero = HEROES[id]
    const pickedBy = Object.entries(props.pickedHeroes).find(([, hid]) => hid === id)
    return {
      ...hero,
      picked: !!pickedBy,
      pickedByName: pickedBy?.[0] ?? null,
    }
  }),
)

const selectedHeroDef = computed(() =>
  selectedHero.value ? HEROES[selectedHero.value] : null,
)

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
  const hero = heroList.value.find(h => h.id === id)
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
  <div class="hero-picker">
    <div class="hp__header">
      <span class="hp__title">SELECT YOUR HERO</span>
      <span class="hp__timer" :class="{ 'hp__timer--urgent': countdown <= 10 }">
        {{ countdown }}s
      </span>
    </div>

    <div class="hp__grid">
      <div
        v-for="hero in heroList"
        :key="hero.id"
        class="hp__card"
        :class="{
          'hp__card--selected': selectedHero === hero.id,
          'hp__card--picked': hero.picked,
          'hp__card--confirmed': confirmed && selectedHero === hero.id,
        }"
        @click="selectHero(hero.id)"
      >
        <div class="hp__card-header">
          <span class="hp__card-icon">{{ ROLE_ICONS[hero.role] || '??' }}</span>
          <span class="hp__card-name">{{ hero.name }}</span>
        </div>
        <div class="hp__card-role">{{ hero.role }}</div>
        <div class="hp__card-stats">
          <span>HP:{{ hero.baseStats.hp }}</span>
          <span>MP:{{ hero.baseStats.mp }}</span>
          <span>ATK:{{ hero.baseStats.attack }}</span>
          <span>DEF:{{ hero.baseStats.defense }}</span>
        </div>
        <div v-if="hero.picked" class="hp__card-picked">
          PICKED
        </div>
      </div>
    </div>

    <div v-if="selectedHeroDef" class="hp__detail">
      <TerminalPanel :title="selectedHeroDef.name">
        <div class="hp__detail-body">
          <div class="hp__detail-lore">{{ selectedHeroDef.lore }}</div>
          <div class="hp__detail-abilities">
            <div class="hp__ability">
              <span class="hp__ability-key">P</span>
              <span class="hp__ability-name">{{ selectedHeroDef.passive.name }}</span>
              <span class="hp__ability-desc">{{ selectedHeroDef.passive.description }}</span>
            </div>
            <div v-for="slot in (['q', 'w', 'e', 'r'] as const)" :key="slot" class="hp__ability">
              <span class="hp__ability-key">{{ slot.toUpperCase() }}</span>
              <span class="hp__ability-name">{{ selectedHeroDef.abilities[slot].name }}</span>
              <span class="hp__ability-desc">{{ selectedHeroDef.abilities[slot].description }}</span>
            </div>
          </div>
        </div>
      </TerminalPanel>
    </div>

    <div class="hp__footer">
      <div class="hp__roster">
        <span class="hp__roster-title">TEAM:</span>
        <span
          v-for="member in teamRoster"
          :key="member.playerId"
          class="hp__roster-member"
          :class="{ 'hp__roster-member--ready': member.heroId }"
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

<style scoped>
.hero-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--bg-primary);
  min-height: 100vh;
}

.hp__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.hp__title {
  color: var(--color-ability);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.hp__timer {
  color: var(--text-primary);
  font-size: 1.25rem;
  font-weight: 700;
}

.hp__timer--urgent {
  color: var(--color-dire);
  animation: blink 1s step-end infinite;
}

.hp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.hp__card {
  padding: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
}

.hp__card:hover:not(.hp__card--picked) {
  border-color: var(--border-glow);
}

.hp__card--selected {
  border-color: var(--color-ability);
  box-shadow: 0 0 8px rgba(0, 212, 255, 0.2);
}

.hp__card--confirmed {
  border-color: var(--color-radiant);
  box-shadow: 0 0 8px rgba(46, 204, 113, 0.3);
}

.hp__card--picked {
  opacity: 0.3;
  cursor: not-allowed;
}

.hp__card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.hp__card-icon {
  color: var(--color-ability);
  font-weight: 700;
  font-size: 0.85rem;
}

.hp__card-name {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 0.85rem;
  text-transform: uppercase;
}

.hp__card-role {
  color: var(--text-dim);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 6px;
}

.hp__card-stats {
  display: flex;
  gap: 8px;
  font-size: 0.65rem;
  color: var(--text-dim);
}

.hp__card-picked {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--color-dire);
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.2em;
}

.hp__detail {
  max-height: 240px;
  overflow: auto;
}

.hp__detail-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hp__detail-lore {
  color: var(--text-dim);
  font-size: 0.75rem;
  font-style: italic;
  line-height: 1.5;
}

.hp__detail-abilities {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hp__ability {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.75rem;
  padding: 2px 0;
}

.hp__ability-key {
  color: var(--color-ability);
  font-weight: 700;
  flex-shrink: 0;
  width: 16px;
}

.hp__ability-name {
  color: var(--text-primary);
  font-weight: 700;
  flex-shrink: 0;
  min-width: 120px;
}

.hp__ability-desc {
  color: var(--text-dim);
}

.hp__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

.hp__roster {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 0.75rem;
}

.hp__roster-title {
  color: var(--text-dim);
  font-weight: 700;
}

.hp__roster-member {
  color: var(--text-dim);
}

.hp__roster-member--ready {
  color: var(--color-radiant);
}
</style>
