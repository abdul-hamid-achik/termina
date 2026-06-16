<script setup lang="ts">
import { computed } from 'vue'
import type {
  PlayerState,
  CreepState,
  NeutralCreepState,
  TowerState,
  TeamId,
} from '~~/shared/types/game'
import { HEROES } from '~~/shared/constants/heroes'
import { ZONE_MAP } from '~~/shared/constants/zones'
import {
  MELEE_CREEP_HP,
  RANGED_CREEP_HP,
  SIEGE_CREEP_HP,
  DENY_HP_THRESHOLD,
} from '~~/shared/constants/balance'
import { computeThreat, threatToneClass } from '~/utils/tactics'
import ProgressBar from '~/components/ui/ProgressBar.vue'

/** A visible creep plus its index in the client's creeps array (for `attack creep:<i>`). */
type IndexedCreep = CreepState & { index: number }

const props = withDefaults(
  defineProps<{
    zoneName: string
    /** Zone id (for ZONE_MAP lookup: type, owning team, shop). */
    zoneId?: string
    playerTeam: TeamId
    enemies?: PlayerState[]
    allies?: PlayerState[]
    creeps?: IndexedCreep[]
    neutrals?: NeutralCreepState[]
    tower?: TowerState | null
  }>(),
  {
    zoneId: '',
    enemies: () => [],
    allies: () => [],
    creeps: () => [],
    neutrals: () => [],
    tower: null,
  },
)

const emit = defineEmits<{
  command: [cmd: string]
}>()

function heroName(p: PlayerState): string {
  return (p.heroId && HEROES[p.heroId]?.name) || p.name
}

function attackHero(p: PlayerState) {
  emit('command', `attack hero:${p.heroId ?? p.name}`)
}

// ── Creep groups ───────────────────────────────────────────────
const enemyCreeps = computed(() =>
  props.creeps.filter((c) => c.team !== props.playerTeam && c.hp > 0),
)
const alliedCreeps = computed(() =>
  props.creeps.filter((c) => c.team === props.playerTeam && c.hp > 0),
)

function lowestHpCreep(group: IndexedCreep[]): IndexedCreep | null {
  if (group.length === 0) return null
  return group.reduce((min, c) => (c.hp < min.hp ? c : min))
}

const lowestEnemyCreep = computed(() => lowestHpCreep(enemyCreeps.value))
const lowestAlliedCreep = computed(() => lowestHpCreep(alliedCreeps.value))

/** Last-hit helper: attack the lowest-HP enemy creep in the zone. */
function attackLowestCreep() {
  const target = lowestEnemyCreep.value
  if (target) emit('command', `attack creep:${target.index}`)
}

// ── Deny ───────────────────────────────────────────────────────
// An allied creep can only be denied once it drops below the deny HP
// threshold (mirrors the server's DENY_HP_THRESHOLD check). Surface the
// affordance only when a denyable creep exists so the tap can't no-op.
function creepMaxHp(c: IndexedCreep): number {
  return c.type === 'siege'
    ? SIEGE_CREEP_HP
    : c.type === 'ranged'
      ? RANGED_CREEP_HP
      : MELEE_CREEP_HP
}

const denyableAlliedCreep = computed<IndexedCreep | null>(() => {
  const eligible = alliedCreeps.value.filter((c) => c.hp <= creepMaxHp(c) * DENY_HP_THRESHOLD)
  return lowestHpCreep(eligible)
})

/** Deny helper: deny the lowest-HP eligible allied creep in the zone. */
function denyLowestCreep() {
  const target = denyableAlliedCreep.value
  if (target) emit('command', `deny creep:${target.index}`)
}

// ── Tower ──────────────────────────────────────────────────────
const towerHere = computed(() => (props.tower?.alive ? props.tower : null))
const towerIsEnemy = computed(
  () => towerHere.value !== null && towerHere.value.team !== props.playerTeam,
)

function attackTower() {
  if (towerHere.value && towerIsEnemy.value) {
    emit('command', `attack tower:${towerHere.value.zone}`)
  }
}

const aliveNeutrals = computed(() => props.neutrals.filter((n) => n.alive))

// ── At-a-glance status header ──────────────────────────────────
// Zone identity, a color-coded threat verdict, and a zone-local objective so
// "what is this place / am I safe here / what do I do" is answerable without
// parsing the unit list below.
const zoneMeta = computed(() => (props.zoneId ? ZONE_MAP[props.zoneId] : undefined))

const identityTag = computed(() => {
  const m = zoneMeta.value
  if (!m) return 'ZONE'
  const owner = m.team === 'neutral' ? '' : ` · ${m.team === props.playerTeam ? 'ours' : 'enemy'}`
  return `${m.type}${owner}`
})

const identityClass = computed(() => {
  const m = zoneMeta.value
  if (!m || m.team === 'neutral') return 'text-text-dim'
  return m.team === props.playerTeam ? 'text-radiant' : 'text-dire'
})

/** Allied hero headcount including the local player (always present in-zone). */
const allyHeadcount = computed(() => props.allies.length + 1)

const threat = computed(() =>
  computeThreat(
    props.enemies.length,
    allyHeadcount.value,
    towerHere.value !== null && towerIsEnemy.value,
  ),
)

const threatClass = computed(() => threatToneClass(threat.value.tone))

const objective = computed<string | null>(() => {
  const m = zoneMeta.value
  if (towerHere.value && towerIsEnemy.value) return 'Destroy the enemy tower'
  if (!m) return null
  switch (m.type) {
    case 'fountain':
      return 'Heal & buy items'
    case 'base':
      return m.team === props.playerTeam ? 'Defend the base' : 'Break into the base'
    case 'river':
      return 'Contest runes & river'
    case 'jungle':
      return 'Farm neutral camps'
    case 'lane':
      return alliedCreeps.value.length > 0 ? 'Push with your creeps' : 'Hold for your wave'
    default:
      return null
  }
})

const isEmpty = computed(
  () =>
    props.enemies.length === 0 &&
    props.allies.length === 0 &&
    enemyCreeps.value.length === 0 &&
    alliedCreeps.value.length === 0 &&
    aliveNeutrals.value.length === 0 &&
    towerHere.value === null,
)
</script>

<template>
  <div
    class="flex flex-col gap-1 overflow-y-auto p-2 font-mono text-[0.75rem]"
    data-testid="zone-panel"
  >
    <!-- Status header: identity · threat verdict · objective -->
    <div class="mb-0.5 border-b border-border/40 pb-1" data-testid="zone-status">
      <div class="flex items-baseline justify-between gap-2">
        <span class="t-caption uppercase tracking-wider" :class="identityClass">{{
          identityTag
        }}</span>
        <span class="font-bold" :class="threatClass" data-testid="zone-threat">{{
          threat.label
        }}</span>
      </div>
      <div class="flex items-baseline justify-between gap-2">
        <span>
          <span class="text-radiant">{{ allyHeadcount }} allied</span>
          <span class="text-text-dim"> · </span>
          <span :class="enemies.length > 0 ? 'text-dire' : 'text-text-dim'"
            >{{ enemies.length }} hostile</span
          >
        </span>
        <span v-if="objective" class="truncate text-text-dim" data-testid="zone-objective"
          >▸ {{ objective }}</span
        >
      </div>
    </div>

    <div v-if="isEmpty" class="text-text-dim" data-testid="zone-panel-empty">
      &gt;_ no other units in {{ zoneName }}
    </div>

    <!-- Enemy heroes: tap to attack -->
    <button
      v-for="e in enemies"
      :key="e.id"
      class="block w-full border border-dire/40 bg-dire/5 px-2 py-1 text-left transition-all hover:bg-dire/15 active:scale-[0.99]"
      :data-testid="`zone-enemy-${e.id}`"
      :title="`Attack ${heroName(e)}`"
      @click="attackHero(e)"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="truncate font-bold text-dire">{{ heroName(e) }}</span>
        <span class="shrink-0 t-caption">Lv {{ e.level }} · [ATK]</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">HP</span>
        <ProgressBar :value="e.hp" :max="e.maxHp" color="dire" :width="10" />
        <span class="text-text-primary">{{ e.hp }}/{{ e.maxHp }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">MP</span>
        <ProgressBar :value="e.mp" :max="e.maxMp" color="mana" :width="10" />
        <span class="text-text-dim">{{ e.mp }}/{{ e.maxMp }}</span>
      </div>
    </button>

    <!-- Allied heroes -->
    <div
      v-for="a in allies"
      :key="a.id"
      class="border border-border/60 px-2 py-1"
      :data-testid="`zone-ally-${a.id}`"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="truncate text-radiant">{{ heroName(a) }}</span>
        <span class="shrink-0 t-caption">Lv {{ a.level }} · ally</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">HP</span>
        <ProgressBar :value="a.hp" :max="a.maxHp" color="radiant" :width="10" />
        <span class="text-text-primary">{{ a.hp }}/{{ a.maxHp }}</span>
      </div>
    </div>

    <!-- Tower -->
    <component
      :is="towerIsEnemy ? 'button' : 'div'"
      v-if="towerHere"
      class="block w-full border px-2 py-1 text-left"
      :class="
        towerIsEnemy
          ? 'border-dire/40 transition-all hover:bg-dire/15 active:scale-[0.99]'
          : 'border-border/60'
      "
      data-testid="zone-tower"
      @click="attackTower"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span :class="towerIsEnemy ? 'text-dire' : 'text-radiant'">
          Tower ({{ towerHere.team }})
        </span>
        <span class="shrink-0 t-caption">{{ towerIsEnemy ? '[ATK]' : 'allied' }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">HP</span>
        <ProgressBar
          :value="towerHere.hp"
          :max="towerHere.maxHp"
          :color="towerIsEnemy ? 'dire' : 'radiant'"
          :width="10"
        />
        <span class="text-text-primary">{{ towerHere.hp }}/{{ towerHere.maxHp }}</span>
      </div>
    </component>

    <!-- Enemy creep group: tap to last-hit the lowest-HP creep -->
    <button
      v-if="enemyCreeps.length > 0"
      class="block w-full border border-dire/30 px-2 py-1 text-left transition-all hover:bg-dire/10 active:scale-[0.99]"
      data-testid="zone-creeps-enemy"
      title="Attack the lowest-HP enemy creep"
      @click="attackLowestCreep"
    >
      <span class="text-dire"
        >{{ enemyCreeps.length }}× enemy creep{{ enemyCreeps.length === 1 ? '' : 's' }}</span
      >
      <span v-if="lowestEnemyCreep" class="text-text-dim">
        · lowest {{ lowestEnemyCreep.hp }}hp</span
      >
      <span class="t-caption"> · [last-hit]</span>
    </button>

    <!-- Allied creep group: tap to deny the lowest-HP creep once it's below
         the deny threshold (no-op affordance is hidden until then). -->
    <component
      :is="denyableAlliedCreep ? 'button' : 'div'"
      v-if="alliedCreeps.length > 0"
      class="block w-full border px-2 py-1 text-left"
      :class="
        denyableAlliedCreep
          ? 'border-gold/40 transition-all hover:bg-gold/10 active:scale-[0.99]'
          : 'border-border/40'
      "
      data-testid="zone-creeps-ally"
      :title="denyableAlliedCreep ? 'Deny the lowest-HP allied creep (below 50% HP)' : undefined"
      @click="denyLowestCreep"
    >
      <span class="text-radiant"
        >{{ alliedCreeps.length }}× allied creep{{ alliedCreeps.length === 1 ? '' : 's' }}</span
      >
      <span v-if="lowestAlliedCreep" class="text-text-dim">
        · lowest {{ lowestAlliedCreep.hp }}hp</span
      >
      <span v-if="denyableAlliedCreep" class="t-caption text-gold"> · [deny]</span>
    </component>

    <!-- Neutral creeps -->
    <div
      v-if="aliveNeutrals.length > 0"
      class="border border-border/40 px-2 py-1"
      data-testid="zone-neutrals"
    >
      <span class="text-gold"
        >{{ aliveNeutrals.length }}× neutral{{ aliveNeutrals.length === 1 ? '' : 's' }}</span
      >
      <span class="text-text-dim">
        · lowest {{ Math.min(...aliveNeutrals.map((n) => n.hp)) }}hp</span
      >
    </div>
  </div>
</template>
