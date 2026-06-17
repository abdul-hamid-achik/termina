<script setup lang="ts">
import { computed } from 'vue'
import type { TeamId, GameMode } from '~~/shared/types/game'
import type { PlayerEndStats } from '~~/shared/types/protocol'
import { HEROES } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import { computeMvp } from '~/utils/postgame'

const props = defineProps<{
  winner: TeamId
  stats: Record<string, PlayerEndStats>
  players: Array<{
    id: string
    name: string
    heroId: string
    team: TeamId
  }>
  currentPlayerId: string
  mmrChange?: number
  gameId?: string | null
  /** Mode of the concluded game; 'tutorial' swaps in a learn-the-ropes wrap-up. */
  mode?: GameMode
}>()

// After a tutorial we nudge the player toward a real match rather than framing
// it as a ranked result — and 'PLAY AGAIN' (→ lobby) becomes 'FIND A REAL MATCH'.
const isTutorial = computed(() => props.mode === 'tutorial')

const emit = defineEmits<{
  playAgain: []
  returnToMenu: []
}>()

interface ScoreRow {
  id: string
  name: string
  heroId: string
  team: TeamId
  kills: number
  deaths: number
  assists: number
  gold: number
  heroDamage: number
  towerDamage: number
  items: (string | null)[]
  isCurrentPlayer: boolean
}

const radiantPlayers = computed((): ScoreRow[] =>
  props.players.filter((p) => p.team === 'radiant').map((p) => toRow(p)),
)

const direPlayers = computed((): ScoreRow[] =>
  props.players.filter((p) => p.team === 'dire').map((p) => toRow(p)),
)

const myStats = computed(() => {
  const s = props.stats[props.currentPlayerId]
  if (!s) return null
  return s
})

// The single standout performer across both teams (the "who carried" beat).
const mvp = computed(() =>
  computeMvp([...radiantPlayers.value, ...direPlayers.value], props.winner),
)

function toRow(p: { id: string; name: string; heroId: string; team: TeamId }): ScoreRow {
  const s = props.stats[p.id]
  return {
    id: p.id,
    name: p.name,
    heroId: p.heroId,
    team: p.team,
    kills: s?.kills ?? 0,
    deaths: s?.deaths ?? 0,
    assists: s?.assists ?? 0,
    gold: s?.gold ?? 0,
    heroDamage: s?.heroDamage ?? 0,
    towerDamage: s?.towerDamage ?? 0,
    items: s?.items ?? [],
    isCurrentPlayer: p.id === props.currentPlayerId,
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col gap-4 bg-bg-primary p-4" data-testid="post-game">
    <div
      class="anim-fade-in-up border-2 p-6 text-center"
      :class="winner === 'radiant' ? 'border-radiant bloom-radiant' : 'border-dire bloom-dire'"
    >
      <div class="t-caption mb-2 text-text-muted">
        {{ isTutorial ? '// tutorial complete' : '// match concluded' }}
      </div>
      <span
        class="t-display tracking-[0.2em] anim-glow-pulse"
        :class="winner === 'radiant' ? 'text-radiant' : 'text-dire'"
      >
        {{ winner === 'radiant' ? 'RADIANT VICTORY' : 'DIRE VICTORY' }}
      </span>
      <p v-if="isTutorial" class="mt-3 text-sm text-text-dim" data-testid="tutorial-wrapup">
        You've got the basics — move, last-hit, cast, and buy. Ready for a real match?
      </p>
    </div>

    <!-- Match MVP — the standout performer across both teams -->
    <div
      v-if="mvp"
      class="anim-fade-in-up flex items-center justify-center gap-3 border p-3"
      :class="mvp.team === 'radiant' ? 'border-radiant/60' : 'border-dire/60'"
      data-testid="post-game-mvp"
    >
      <span class="t-h1 text-gold text-glow-gold" aria-hidden="true">★</span>
      <div class="flex flex-col">
        <span class="t-caption uppercase tracking-wider text-gold">Match MVP</span>
        <span
          class="t-h2"
          :class="mvp.team === 'radiant' ? 'text-radiant' : 'text-dire'"
          data-testid="mvp-name"
          >{{ mvp.name }}
          <span class="text-text-dim">({{ HEROES[mvp.heroId]?.name ?? mvp.heroId }})</span></span
        >
        <span class="t-caption t-mono-num text-text-dim">
          {{ mvp.kills }}/{{ mvp.deaths }}/{{ mvp.assists }} ·
          {{ mvp.heroDamage.toLocaleString() }} hero dmg
        </span>
      </div>
    </div>

    <div v-if="myStats">
      <TerminalPanel title="Your Performance">
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          <div class="flex flex-col gap-1">
            <span class="t-caption uppercase">K/D/A</span>
            <span class="t-h1 t-mono-num">
              <span class="text-radiant text-glow-radiant">{{ myStats.kills }}</span>
              <span class="mx-0.5 text-text-muted">/</span>
              <span class="text-dire text-glow-dire">{{ myStats.deaths }}</span>
              <span class="mx-0.5 text-text-muted">/</span>
              <span class="text-text-dim">{{ myStats.assists }}</span>
            </span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="t-caption uppercase">Hero Damage</span>
            <span class="t-h1 text-text-primary text-glow-sm t-mono-num">{{
              myStats.heroDamage.toLocaleString()
            }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="t-caption uppercase">Tower Damage</span>
            <span class="t-h1 text-text-primary text-glow-sm t-mono-num">{{
              myStats.towerDamage.toLocaleString()
            }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="t-caption uppercase">Gold Earned</span>
            <span class="t-h1 text-gold text-glow-gold t-mono-num">{{
              myStats.gold.toLocaleString()
            }}</span>
          </div>
          <div v-if="mmrChange !== undefined" class="flex flex-col gap-1">
            <span class="t-caption uppercase">MMR</span>
            <span
              class="t-h1 t-mono-num"
              :class="
                mmrChange >= 0 ? 'text-radiant text-glow-radiant' : 'text-dire text-glow-dire'
              "
            >
              {{ mmrChange >= 0 ? '+' : '' }}{{ mmrChange }}
            </span>
          </div>
        </div>
      </TerminalPanel>
    </div>

    <div>
      <TerminalPanel title="Scoreboard">
        <div class="t-h3 pb-1 pt-1.5 text-radiant text-glow-radiant">RADIANT</div>
        <div class="mb-3 overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Hero
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Player
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  K
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  D
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  A
                </th>
                <th
                  class="hidden border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim md:table-cell"
                >
                  DMG
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Gold
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in radiantPlayers"
                :key="p.id"
                class="anim-fade-in-up"
                :class="{
                  'bg-ability/10 font-bold shadow-[inset_3px_0_0_rgb(var(--color-ability))]':
                    p.isCurrentPlayer,
                }"
              >
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-ability">
                  {{ HEROES[p.heroId]?.name ?? p.heroId }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5">
                  {{ p.name }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-radiant">
                  {{ p.kills }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-dire">
                  {{ p.deaths }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-text-dim">
                  {{ p.assists }}
                </td>
                <td
                  class="hidden whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 md:table-cell"
                >
                  {{ p.heroDamage.toLocaleString() }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-gold">
                  {{ p.gold.toLocaleString() }}
                </td>
                <td class="border-b border-border/50 px-1.5 py-0.5 text-[0.65rem] text-text-dim">
                  <span v-for="(item, i) in p.items.slice(0, 6)" :key="i">
                    {{ item ? (ITEMS[item]?.name ?? item) : '-' }}{{ i < 5 ? ' ' : '' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="t-h3 pb-1 pt-1.5 text-dire text-glow-dire">DIRE</div>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Hero
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Player
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  K
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  D
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  A
                </th>
                <th
                  class="hidden border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim md:table-cell"
                >
                  DMG
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Gold
                </th>
                <th
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in direPlayers"
                :key="p.id"
                class="anim-fade-in-up"
                :class="{
                  'bg-ability/10 font-bold shadow-[inset_3px_0_0_rgb(var(--color-ability))]':
                    p.isCurrentPlayer,
                }"
              >
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-ability">
                  {{ HEROES[p.heroId]?.name ?? p.heroId }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5">
                  {{ p.name }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-radiant">
                  {{ p.kills }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-dire">
                  {{ p.deaths }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-text-dim">
                  {{ p.assists }}
                </td>
                <td
                  class="hidden whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 md:table-cell"
                >
                  {{ p.heroDamage.toLocaleString() }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-gold">
                  {{ p.gold.toLocaleString() }}
                </td>
                <td class="border-b border-border/50 px-1.5 py-0.5 text-[0.65rem] text-text-dim">
                  <span v-for="(item, i) in p.items.slice(0, 6)" :key="i">
                    {{ item ? (ITEMS[item]?.name ?? item) : '-' }}{{ i < 5 ? ' ' : '' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </TerminalPanel>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
      <AsciiButton
        :label="isTutorial ? 'FIND A REAL MATCH' : 'PLAY AGAIN'"
        variant="primary"
        data-testid="play-again-btn"
        @click="emit('playAgain')"
      />
      <NuxtLink
        v-if="gameId"
        :to="`/replay/${gameId}`"
        class="inline-flex items-center gap-1 border border-ability bg-bg-secondary px-3 py-1.5 font-mono text-sm text-ability shadow-glow-ability transition-all hover:bg-ability/10 hover:shadow-glow-ability-lg"
      >
        [WATCH REPLAY]
      </NuxtLink>
      <AsciiButton
        label="MAIN MENU"
        variant="ghost"
        data-testid="return-to-menu-btn"
        @click="emit('returnToMenu')"
      />
    </div>
  </div>
</template>
