<script setup lang="ts">
import { computed } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'
import ProgressBar from '~/components/ui/ProgressBar.vue'
import { displayBuffs, type DisplayBuff } from '~/utils/buffs'
import type { PlayerState, FoggedPlayer } from '~~/shared/types/game'

type Enemy = PlayerState | FoggedPlayer

const props = defineProps<{
  enemies: Enemy[]
  lastSeen: Record<string, { zone: string; tick: number }>
  tick: number
}>()

interface ThreatRow {
  id: string
  name: string
  level: number
  alive: boolean
  fogged: boolean
  hp?: number
  maxHp?: number
  mp?: number
  maxMp?: number
  cooldowns?: { q: number; w: number; e: number; r: number }
  /** Transient status effects on a visible enemy (BKB up, stunned, slowed…). */
  status: DisplayBuff[]
  respawnIn: number
  lastSeen: string | null
}

const ABILITIES = ['q', 'w', 'e', 'r'] as const

const rows = computed<ThreatRow[]>(() =>
  props.enemies.map((e) => {
    const fogged = (e as FoggedPlayer).fogged === true
    const full = e as PlayerState
    const ls = props.lastSeen[e.id]
    return {
      id: e.id,
      name: (e.heroId && HEROES[e.heroId]?.name) || e.name,
      level: e.level,
      alive: e.alive,
      fogged,
      hp: fogged ? undefined : full.hp,
      maxHp: fogged ? undefined : full.maxHp,
      mp: fogged ? undefined : full.mp,
      maxMp: fogged ? undefined : full.maxMp,
      cooldowns: fogged ? undefined : full.cooldowns,
      // Only TRANSIENT (timed) effects are threat intel — a ticking BKB, a stun,
      // a slow. Near-permanent stat auras (Treads mode etc., ticks === null) are
      // dropped so the sheet stays focused on the current engagement.
      status: fogged ? [] : displayBuffs(full.buffs ?? []).filter((b) => b.ticks !== null),
      // -1 when we don't know the respawn (fogged death) so the UI can hide the
      // misleading "respawn 0t".
      respawnIn: full.respawnTick != null ? Math.max(0, full.respawnTick - props.tick) : -1,
      lastSeen: ls ? `${ls.zone} · ${Math.max(0, props.tick - ls.tick)}t` : null,
    }
  }),
)
</script>

<template>
  <div data-testid="enemy-threat-sheet" class="flex flex-col gap-1.5 font-mono text-[0.7rem]">
    <div v-for="r in rows" :key="r.id" class="border-l-2 border-dire/40 pl-1.5">
      <div class="flex items-baseline justify-between gap-1">
        <span
          class="truncate font-bold"
          :class="r.alive ? 'text-dire' : 'text-text-dim line-through'"
          >{{ r.name }}</span
        >
        <span class="shrink-0 text-[0.6rem] text-text-dim">Lv{{ r.level }}</span>
      </div>

      <!-- Dead -->
      <div
        v-if="!r.alive"
        class="text-[0.62rem] text-text-dim"
        :data-testid="`threat-dead-${r.id}`"
      >
        DEAD<template v-if="r.respawnIn >= 0"> · respawn {{ r.respawnIn }}t</template>
      </div>

      <!-- Fogged (last-seen intel only) -->
      <div
        v-else-if="r.fogged"
        class="text-[0.62rem] text-text-dim"
        :data-testid="`threat-fogged-${r.id}`"
      >
        <span class="text-warn">? fogged</span>
        <span v-if="r.lastSeen"> · last {{ r.lastSeen }}</span>
      </div>

      <!-- Visible & alive: vitals + ability cooldowns -->
      <template v-else>
        <div class="flex items-center gap-1">
          <span class="w-4 shrink-0 text-[0.58rem] text-text-dim">HP</span>
          <ProgressBar :value="r.hp ?? 0" :max="r.maxHp ?? 1" color="dire" :width="8" />
        </div>
        <div class="flex items-center gap-1">
          <span class="w-4 shrink-0 text-[0.58rem] text-text-dim">MP</span>
          <ProgressBar :value="r.mp ?? 0" :max="r.maxMp ?? 1" color="mana" :width="8" />
        </div>
        <div class="mt-0.5 flex gap-1" :data-testid="`threat-cooldowns-${r.id}`">
          <span
            v-for="k in ABILITIES"
            :key="k"
            class="inline-flex min-w-[18px] justify-center border px-0.5 text-[0.58rem]"
            :class="
              (r.cooldowns?.[k] ?? 0) > 0
                ? 'border-border text-text-muted'
                : 'border-ability/60 text-ability'
            "
          >
            {{ k.toUpperCase() }}{{ (r.cooldowns?.[k] ?? 0) > 0 ? r.cooldowns![k] : '' }}
          </span>
        </div>

        <!-- Status intel, coloured from MY perspective (inverse of the bearer's):
             a debuff on them is my opening (green); a buff they hold is a caution
             (amber). The objective good/bad `kind` comes from ~/utils/buffs. -->
        <div
          v-if="r.status.length"
          class="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5"
          :data-testid="`threat-status-${r.id}`"
        >
          <span
            v-for="b in r.status"
            :key="b.id"
            class="text-[0.58rem]"
            :class="b.kind === 'negative' ? 'text-radiant' : 'text-warn'"
            >{{ b.label
            }}<span v-if="b.ticks !== null" class="opacity-70">·{{ b.ticks }}</span></span
          >
        </div>
      </template>
    </div>

    <div v-if="!rows.length" class="text-text-dim">&gt;_ no enemy intel</div>
  </div>
</template>
