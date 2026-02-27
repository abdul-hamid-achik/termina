<script setup lang="ts">
import { computed } from 'vue'
import type { TeamId } from '~~/shared/types/game'
import type { PlayerEndStats } from '~~/shared/types/protocol'

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
}>()

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
  <div class="flex min-h-screen flex-col gap-4 bg-bg-primary p-4">
    <div
      class="border p-4 text-center"
      :class="
        winner === 'radiant'
          ? 'border-radiant shadow-glow-radiant-lg'
          : 'border-dire shadow-glow-dire-lg'
      "
    >
      <span
        class="text-2xl font-bold tracking-[0.2em] text-glow"
        :class="winner === 'radiant' ? 'text-radiant' : 'text-dire'"
      >
        {{ winner === 'radiant' ? 'RADIANT VICTORY' : 'DIRE VICTORY' }}
      </span>
    </div>

    <div v-if="myStats">
      <TerminalPanel title="Your Performance">
        <div class="flex flex-wrap gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-[0.7rem] uppercase tracking-widest text-text-dim">K/D/A</span>
            <span class="text-base font-bold">
              <span class="text-radiant">{{ myStats.kills }}</span>
              <span class="mx-0.5 text-text-dim">/</span>
              <span class="text-dire">{{ myStats.deaths }}</span>
              <span class="mx-0.5 text-text-dim">/</span>
              <span class="text-text-dim">{{ myStats.assists }}</span>
            </span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[0.7rem] uppercase tracking-widest text-text-dim">Hero Damage</span>
            <span class="text-base font-bold text-text-primary">{{
              myStats.heroDamage.toLocaleString()
            }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[0.7rem] uppercase tracking-widest text-text-dim">Tower Damage</span>
            <span class="text-base font-bold text-text-primary">{{
              myStats.towerDamage.toLocaleString()
            }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[0.7rem] uppercase tracking-widest text-text-dim">Gold Earned</span>
            <span class="text-base font-bold text-gold">{{ myStats.gold.toLocaleString() }}</span>
          </div>
          <div v-if="mmrChange !== undefined" class="flex flex-col gap-0.5">
            <span class="text-[0.7rem] uppercase tracking-widest text-text-dim">MMR</span>
            <span
              class="text-base font-bold"
              :class="mmrChange >= 0 ? 'text-radiant' : 'text-dire'"
            >
              {{ mmrChange >= 0 ? '+' : '' }}{{ mmrChange }}
            </span>
          </div>
        </div>
      </TerminalPanel>
    </div>

    <div>
      <TerminalPanel title="Scoreboard">
        <div class="text-xs font-bold tracking-widest text-radiant pb-1 pt-1.5">RADIANT</div>
        <table class="mb-3 w-full border-collapse text-xs">
          <thead>
            <tr>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                Hero
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                Player
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                K
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                D
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                A
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                DMG
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                Gold
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                Items
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in radiantPlayers"
              :key="p.id"
              :class="{ 'bg-ability/5 font-bold': p.isCurrentPlayer }"
            >
              <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-ability">
                {{ p.heroId }}
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
              <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5">
                {{ p.heroDamage.toLocaleString() }}
              </td>
              <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-gold">
                {{ p.gold.toLocaleString() }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-0.5 text-[0.65rem] text-text-dim">
                <span v-for="(item, i) in p.items.slice(0, 6)" :key="i">
                  {{ item || '-' }}{{ i < 5 ? ' ' : '' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="text-xs font-bold tracking-widest text-dire pb-1 pt-1.5">DIRE</div>
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                Hero
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                Player
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                K
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                D
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                A
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                DMG
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                Gold
              </th>
              <th class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim">
                Items
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in direPlayers"
              :key="p.id"
              :class="{ 'bg-ability/5 font-bold': p.isCurrentPlayer }"
            >
              <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-ability">
                {{ p.heroId }}
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
              <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5">
                {{ p.heroDamage.toLocaleString() }}
              </td>
              <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-gold">
                {{ p.gold.toLocaleString() }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-0.5 text-[0.65rem] text-text-dim">
                <span v-for="(item, i) in p.items.slice(0, 6)" :key="i">
                  {{ item || '-' }}{{ i < 5 ? ' ' : '' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </TerminalPanel>
    </div>

    <div class="flex justify-center gap-4 pt-2">
      <AsciiButton label="PLAY AGAIN" variant="primary" @click="emit('playAgain')" />
      <AsciiButton label="MAIN MENU" variant="ghost" @click="emit('returnToMenu')" />
    </div>
  </div>
</template>
