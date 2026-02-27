<script setup lang="ts">
interface LeaderboardEntry {
  rank: number
  id: string
  username: string
  avatarUrl: string | null
  mmr: number
  gamesPlayed: number
  wins: number
  winRate: number
}

const { data, status } = await useFetch<{ leaderboard: LeaderboardEntry[] }>('/api/leaderboard')

const players = computed(() => data.value?.leaderboard ?? [])
</script>

<template>
  <div class="mx-auto mt-6 max-w-[700px]">
    <TerminalPanel title="Leaderboard">
      <div class="mb-3 border-b border-border pb-3">
        <span class="text-[0.8rem] text-text-dim">&gt;_ top players by rating</span>
      </div>

      <div v-if="status === 'pending'" class="py-6 text-center text-[0.85rem] text-text-dim">
        Loading leaderboard<span class="animate-blink">_</span>
      </div>

      <div v-else-if="players.length === 0" class="py-6 text-center text-[0.85rem] text-text-dim">
        No players found.
      </div>

      <table v-else class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              #
            </th>
            <th
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              Player
            </th>
            <th
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              Rating
            </th>
            <th
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              W
            </th>
            <th
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              L
            </th>
            <th
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              Win%
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in players" :key="p.id">
            <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ p.rank }}</td>
            <td class="border-b border-border/50 px-1.5 py-1">
              <NuxtLink :to="`/profile/${p.id}`" class="text-ability">{{ p.username }}</NuxtLink>
            </td>
            <td class="border-b border-border/50 px-1.5 py-1 font-bold text-gold">{{ p.mmr }}</td>
            <td class="border-b border-border/50 px-1.5 py-1 text-radiant">{{ p.wins }}</td>
            <td class="border-b border-border/50 px-1.5 py-1 text-dire">
              {{ p.gamesPlayed - p.wins }}
            </td>
            <td class="border-b border-border/50 px-1.5 py-1">{{ p.winRate }}%</td>
          </tr>
        </tbody>
      </table>
    </TerminalPanel>
  </div>
</template>
