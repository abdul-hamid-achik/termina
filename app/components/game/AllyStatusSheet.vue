<script setup lang="ts">
import { computed } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'
import ProgressBar from '~/components/ui/ProgressBar.vue'
import { displayBuffs, type DisplayBuff } from '~/utils/buffs'
import type { PlayerState } from '~~/shared/types/game'

/**
 * Compact ally coordination panel — the friendly counterpart to EnemyThreatSheet.
 * Allies are never fogged (you always see your own team), so this answers the
 * at-a-glance questions that matter for grouping: who's alive, WHERE they are,
 * how healthy, and whether they're disabled or holding a defensive cooldown.
 *
 * Status chips are coloured from the ALLY's own perspective (same as HeroStatus):
 * a buff they hold is good (green), a debuff on them is bad (red) — the inverse of
 * the EnemyThreatSheet, which colours the SAME shared `kind` from my perspective.
 */
const props = defineProps<{
  allies: PlayerState[]
  tick: number
}>()

interface AllyRow {
  id: string
  name: string
  level: number
  alive: boolean
  hp: number
  maxHp: number
  zone: string
  status: DisplayBuff[]
  respawnIn: number
  /** Ultimate off cooldown — the key "can we fight?" coordination signal. */
  ultReady: boolean
}

const rows = computed<AllyRow[]>(() =>
  props.allies.map((a) => ({
    id: a.id,
    name: (a.heroId && HEROES[a.heroId]?.name) || a.name,
    level: a.level,
    alive: a.alive,
    hp: a.hp,
    maxHp: a.maxHp,
    zone: a.zone,
    // Transient effects only — a ticking BKB, a stun — not permanent stat auras.
    status: displayBuffs(a.buffs ?? []).filter((b) => b.ticks !== null),
    respawnIn: a.respawnTick != null ? Math.max(0, a.respawnTick - props.tick) : -1,
    ultReady: (a.cooldowns?.r ?? 0) <= 0,
  })),
)
</script>

<template>
  <div data-testid="ally-status-sheet" class="flex flex-col gap-1.5 font-mono text-[0.7rem]">
    <div v-for="r in rows" :key="r.id" class="border-l-2 border-radiant/40 pl-1.5">
      <div class="flex items-baseline justify-between gap-1">
        <span
          class="truncate font-bold"
          :class="r.alive ? 'text-radiant' : 'text-text-dim line-through'"
          >{{ r.name }}</span
        >
        <span class="flex shrink-0 items-baseline gap-1 text-[0.6rem]">
          <span
            v-if="r.alive && r.ultReady"
            class="font-bold text-radiant text-glow-sm"
            :data-testid="`ally-ult-${r.id}`"
            >ULT</span
          >
          <span class="text-text-dim">Lv{{ r.level }} · {{ r.zone }}</span>
        </span>
      </div>

      <!-- Dead -->
      <div v-if="!r.alive" class="text-[0.62rem] text-text-dim" :data-testid="`ally-dead-${r.id}`">
        DEAD<template v-if="r.respawnIn >= 0"> · respawn {{ r.respawnIn }}t</template>
      </div>

      <!-- Alive: HP + transient status -->
      <template v-else>
        <div class="flex items-center gap-1">
          <span class="w-4 shrink-0 text-[0.58rem] text-text-dim">HP</span>
          <ProgressBar
            :value="r.hp"
            :max="r.maxHp"
            color="radiant"
            :width="8"
            :danger-below="0.25"
          />
        </div>

        <div
          v-if="r.status.length"
          class="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5"
          :data-testid="`ally-status-${r.id}`"
        >
          <span
            v-for="b in r.status"
            :key="b.id"
            class="text-[0.58rem]"
            :class="{
              'text-radiant': b.kind === 'positive',
              'text-dire': b.kind === 'negative',
              'text-ability': b.kind === 'neutral',
            }"
            >{{ b.label
            }}<span v-if="b.ticks !== null" class="opacity-70">·{{ b.ticks }}</span></span
          >
        </div>
      </template>
    </div>

    <div v-if="!rows.length" class="text-text-dim">&gt;_ solo</div>
  </div>
</template>
