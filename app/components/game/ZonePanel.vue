<script setup lang="ts">
import { computed } from 'vue'
import type {
  PlayerState,
  CreepState,
  NeutralCreepState,
  TenantState,
  IceState,
  TeamId,
} from '~~/shared/types/game'
import type { TargetRef } from '~~/shared/types/commands'
import { HEROES } from '~~/shared/constants/heroes'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { creepMaxHp, BURN_HP_THRESHOLD } from '~~/shared/constants/balance'
import { computeThreat, threatToneClass } from '~/utils/tactics'
import ProgressBar from '~/components/ui/ProgressBar.vue'

/** A visible creep plus its index in the client's creeps array (for `attack creep:<i>`). */
type IndexedCreep = CreepState & { index: number }

/** A neutral plus its index in the GLOBAL neutrals array — the index the server
 *  resolves `attack neutral:<i>` against, so it must survive the zone filter. */
type IndexedNeutral = NeutralCreepState & { index: number }

const props = withDefaults(
  defineProps<{
    zoneName: string
    /** Zone id (for ZONE_MAP lookup: type, owning team, shop). */
    zoneId?: string
    playerTeam: TeamId
    enemies?: PlayerState[]
    allies?: PlayerState[]
    creeps?: IndexedCreep[]
    neutrals?: IndexedNeutral[]
    ice?: IceState | null
    /** Tenant, passed only when the player stands in the pit and he is alive. */
    tenant?: TenantState | null
    /** The player's standing attack order, if any — the engine re-swings at it
     *  every tick until it dies, leaves, or a new order lands. */
    attackTarget?: TargetRef | null
  }>(),
  {
    zoneId: '',
    enemies: () => [],
    allies: () => [],
    creeps: () => [],
    neutrals: () => [],
    ice: null,
    tenant: null,
    attackTarget: null,
  },
)

const emit = defineEmits<{
  command: [cmd: string]
}>()

function heroName(p: PlayerState): string {
  return (p.heroId && HEROES[p.heroId]?.name) || p.name
}

// ── Standing attack order ──────────────────────────────────────
// The engine keeps swinging at a held target every tick, so the row that owns
// it says so — otherwise repeated damage lines look like a bug. Lane creeps
// never hold (last-hitting stays a manual, per-tick decision), so their rows
// deliberately have no [hold] state to show.
const heldIceZone = computed(() =>
  props.attackTarget?.kind === 'ice' ? props.attackTarget.zone : null,
)
const holdingTenant = computed(() => props.attackTarget?.kind === 'tenant')

/** Mirrors the server's hero lookup, which indexes name, id and heroId alike. */
function isHeldHero(p: PlayerState): boolean {
  const t = props.attackTarget
  if (t?.kind !== 'hero') return false
  const key = t.name.toLowerCase()
  return (
    key === p.id.toLowerCase() || key === p.name.toLowerCase() || key === p.heroId?.toLowerCase()
  )
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

// ── Burn ───────────────────────────────────────────────────────
// An allied creep can only be burned once it drops below the burn HP
// threshold (mirrors the server's BURN_HP_THRESHOLD check). Surface the
// affordance only when a denyable creep exists so the tap can't no-op.
// Reads the HP the creep SPAWNED with, not a level-1 constant: creeps escalate
// with match time, so a fixed max made this affordance vanish as the game ran.
function creepFullHp(c: IndexedCreep): number {
  return c.maxHp ?? creepMaxHp(c.type, 0)
}

const denyableAlliedCreep = computed<IndexedCreep | null>(() => {
  const eligible = alliedCreeps.value.filter((c) => c.hp <= creepFullHp(c) * BURN_HP_THRESHOLD)
  return lowestHpCreep(eligible)
})

/** Burn helper: burn the lowest-HP eligible allied creep in the zone. */
function denyLowestCreep() {
  const target = denyableAlliedCreep.value
  if (target) emit('command', `burn creep:${target.index}`)
}

// ── Ice ──────────────────────────────────────────────────────
const iceHere = computed(() => (props.ice?.alive ? props.ice : null))
const iceIsEnemy = computed(() => iceHere.value !== null && iceHere.value.team !== props.playerTeam)

function attackIce() {
  if (iceHere.value && iceIsEnemy.value) {
    emit('command', `attack ice:${iceHere.value.zone}`)
  }
}

const aliveNeutrals = computed(() => props.neutrals.filter((n) => n.alive))

const lowestNeutral = computed<IndexedNeutral | null>(() => {
  if (aliveNeutrals.value.length === 0) return null
  return aliveNeutrals.value.reduce((min, n) => (n.hp < min.hp ? n : min))
})

/** Farm helper: attack the lowest-HP camp member, so the row also last-hits. */
function attackLowestNeutral() {
  const target = lowestNeutral.value
  if (target) emit('command', `attack neutral:${target.index}`)
}

const tenantHere = computed(() => (props.tenant?.alive ? props.tenant : null))

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

/**
 * Team-IDENTITY color, for the two rows that print a team's name next to the
 * swatch (the zone's owner, the ice's team). Painting those by allegiance —
 * green when they are mine — meant a Audit player read "Ice (audit)" in the
 * Chaff green while the map's ▼, the score header and the zone tag beside it
 * all said audit: the label and its color contradicted each other inside one
 * line. Hero rows below deliberately keep the allegiance convention (green =
 * with me, red = against me) shared with AllyStatusSheet, EnemyThreatSheet and
 * the map's ally/enemy counts.
 */
function teamTextClass(team: TeamId): string {
  return team === 'chaff' ? 'text-chaff' : 'text-audit'
}

const identityClass = computed(() => {
  const m = zoneMeta.value
  if (!m || m.team === 'neutral') return 'text-text-dim'
  return teamTextClass(m.team)
})

/** Allied hero headcount including the local player (always present in-zone). */
const allyHeadcount = computed(() => props.allies.length + 1)

const threat = computed(() =>
  computeThreat(
    props.enemies.length,
    allyHeadcount.value,
    iceHere.value !== null && iceIsEnemy.value,
  ),
)

const threatClass = computed(() => threatToneClass(threat.value.tone))

const objective = computed<string | null>(() => {
  const m = zoneMeta.value
  if (iceHere.value && iceIsEnemy.value) return 'Destroy the enemy ice'
  if (!m) return null
  switch (m.type) {
    case 'fountain':
      return 'Heal & buy items'
    case 'base':
      return m.team === props.playerTeam ? 'Defend the base' : 'Break into the base'
    case 'river':
      return 'Contest caches & river'
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
    iceHere.value === null &&
    tenantHere.value === null,
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
          <span class="text-chaff">{{ allyHeadcount }} allied</span>
          <span class="text-text-dim"> · </span>
          <span :class="enemies.length > 0 ? 'text-audit' : 'text-text-dim'"
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
      class="block w-full border border-audit/40 bg-audit/5 px-2 py-1 text-left transition-all hover:bg-audit/15 active:scale-[0.99]"
      :data-testid="`zone-enemy-${e.id}`"
      :title="`Attack ${heroName(e)}`"
      @click="attackHero(e)"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="truncate font-bold text-audit">{{ heroName(e) }}</span>
        <span class="shrink-0 t-caption" :data-testid="`zone-enemy-tag-${e.id}`"
          >Lv {{ e.level }} · {{ isHeldHero(e) ? '[hold]' : '[ATK]' }}</span
        >
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">HP</span>
        <ProgressBar
          :value="e.hp"
          :max="e.maxHp"
          color="audit"
          :width="10"
          :label="`${heroName(e)} HP`"
        />
        <span class="text-text-primary">{{ e.hp }}/{{ e.maxHp }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">MP</span>
        <ProgressBar
          :value="e.mp"
          :max="e.maxMp"
          color="mana"
          :width="10"
          :label="`${heroName(e)} MP`"
        />
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
        <span class="truncate text-chaff">{{ heroName(a) }}</span>
        <span class="shrink-0 t-caption">Lv {{ a.level }} · ally</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">HP</span>
        <ProgressBar
          :value="a.hp"
          :max="a.maxHp"
          color="chaff"
          :width="10"
          :label="`${heroName(a)} HP`"
        />
        <span class="text-text-primary">{{ a.hp }}/{{ a.maxHp }}</span>
      </div>
    </div>

    <!-- Ice -->
    <component
      :is="iceIsEnemy ? 'button' : 'div'"
      v-if="iceHere"
      class="block w-full border px-2 py-1 text-left"
      :class="
        iceIsEnemy
          ? 'border-audit/40 transition-all hover:bg-audit/15 active:scale-[0.99]'
          : 'border-border/60'
      "
      data-testid="zone-ice"
      @click="attackIce"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span :class="teamTextClass(iceHere.team)"> Ice ({{ iceHere.team }}) </span>
        <span class="shrink-0 t-caption" data-testid="zone-ice-tag">{{
          iceIsEnemy ? (heldIceZone === iceHere.zone ? '[hold]' : '[ATK]') : 'allied'
        }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">HP</span>
        <ProgressBar
          :value="iceHere.hp"
          :max="iceHere.maxHp"
          :color="iceHere.team === 'chaff' ? 'chaff' : 'audit'"
          :width="10"
          :label="`Ice ${iceHere.team} HP`"
        />
        <span class="text-text-primary">{{ iceHere.hp }}/{{ iceHere.maxHp }}</span>
      </div>
    </component>

    <!-- Enemy creep group: tap to last-hit the lowest-HP creep -->
    <button
      v-if="enemyCreeps.length > 0"
      class="block w-full border border-audit/30 px-2 py-1 text-left transition-all hover:bg-audit/10 active:scale-[0.99]"
      data-testid="zone-creeps-enemy"
      title="Attack the lowest-HP enemy creep"
      @click="attackLowestCreep"
    >
      <span class="text-audit"
        >{{ enemyCreeps.length }}× enemy creep{{ enemyCreeps.length === 1 ? '' : 's' }}</span
      >
      <span v-if="lowestEnemyCreep" class="text-text-dim">
        · lowest {{ lowestEnemyCreep.hp }}hp</span
      >
      <span class="t-caption"> · [last-hit]</span>
    </button>

    <!-- Allied creep group: tap to burn the lowest-HP creep once it's below
         the burn threshold (no-op affordance is hidden until then). -->
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
      :title="denyableAlliedCreep ? 'Burn the lowest-HP allied creep (below 50% HP)' : undefined"
      @click="denyLowestCreep"
    >
      <span class="text-chaff"
        >{{ alliedCreeps.length }}× allied creep{{ alliedCreeps.length === 1 ? '' : 's' }}</span
      >
      <span v-if="lowestAlliedCreep" class="text-text-dim">
        · lowest {{ lowestAlliedCreep.hp }}hp</span
      >
      <span v-if="denyableAlliedCreep" class="t-caption text-gold"> · [burn]</span>
    </component>

    <!-- Neutral camp: tap to attack the lowest-HP member -->
    <button
      v-if="aliveNeutrals.length > 0"
      class="block w-full border border-gold/40 px-2 py-1 text-left transition-all hover:bg-gold/10 active:scale-[0.99]"
      data-testid="zone-neutrals"
      title="Attack the lowest-HP neutral creep"
      @click="attackLowestNeutral"
    >
      <span class="text-gold"
        >{{ aliveNeutrals.length }}× neutral{{ aliveNeutrals.length === 1 ? '' : 's' }}</span
      >
      <span v-if="lowestNeutral" class="text-text-dim"> · lowest {{ lowestNeutral.hp }}hp</span>
      <span class="t-caption"> · [farm]</span>
    </button>

    <!-- Tenant: only rendered in the pit while he is alive -->
    <button
      v-if="tenantHere"
      class="block w-full border border-gold/60 bg-gold/5 px-2 py-1 text-left transition-all hover:bg-gold/15 active:scale-[0.99]"
      data-testid="zone-tenant"
      title="Attack Tenant"
      @click="emit('command', 'attack tenant')"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-bold text-gold">Tenant</span>
        <span class="shrink-0 t-caption" data-testid="zone-tenant-tag"
          >drops Backup · {{ holdingTenant ? '[hold]' : '[ATK]' }}</span
        >
      </div>
      <div class="flex items-center gap-1">
        <span class="w-5 shrink-0 t-caption">HP</span>
        <ProgressBar
          :value="tenantHere.hp"
          :max="tenantHere.maxHp"
          color="gold"
          :width="10"
          label="Tenant HP"
        />
        <span class="text-text-primary">{{ tenantHere.hp }}/{{ tenantHere.maxHp }}</span>
      </div>
    </button>
  </div>
</template>
