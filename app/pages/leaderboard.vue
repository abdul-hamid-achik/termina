<script setup lang="ts">
import { PLACEMENT_GAMES } from '~~/shared/constants/ranks'

interface LeaderboardEntry {
  rank: number
  id: string
  username: string
  avatarUrl: string | null
  guildTag: string | null
  mmr: number
  lifetimeMmr: number
  rankTier: string
  rankName: string
  gamesPlayed: number
  wins: number
  winRate: number
}

const {
  data,
  status,
  refresh: refreshLeaderboard,
} = await useFetch<{
  season: { number: number; startedAt: string }
  leaderboard: LeaderboardEntry[]
}>('/api/leaderboard')

// Poll the leaderboard every 10s while the page is open.
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(() => {
    void refreshLeaderboard()
  }, 10_000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const players = computed(() => data.value?.leaderboard ?? [])

// Highlight the viewing player's own row so they can spot their rank at a glance
// (null when anonymous — the leaderboard is public).
const { user } = useUserSession()
const meId = computed(() => (user.value?.id as string | undefined) ?? null)
</script>

<template>
  <div class="mx-auto mt-6 flex max-w-[700px] flex-col gap-4">
    <header class="flex items-center justify-between gap-2 border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-chaff">&gt;_ LEADERBOARD</h1>
      <span
        v-if="data?.season"
        class="border border-gold/40 bg-gold/10 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider text-gold"
        data-testid="season-badge"
      >
        Season {{ data.season.number }}
      </span>
    </header>
    <TerminalPanel title="Leaderboard" title-as="h2">
      <div class="mb-3 border-b border-border pb-3">
        <span class="text-[0.8rem] text-text-dim"
          >&gt;_ top players by rating — {{ PLACEMENT_GAMES }} ranked matches to qualify</span
        >
      </div>

      <div v-if="status === 'pending'" class="py-6 text-center text-[0.85rem] text-text-dim">
        Loading leaderboard<span class="animate-blink">_</span>
      </div>

      <div v-else-if="status === 'error'" class="py-6 text-center text-[0.85rem] text-audit">
        Couldn't load the leaderboard.
        <button type="button" class="text-ability hover:text-chaff" @click="refreshLeaderboard()">
          retry
        </button>
      </div>

      <div v-else-if="players.length === 0" class="py-6 text-center text-[0.85rem] text-text-dim">
        Nobody has finished their {{ PLACEMENT_GAMES }} placement matches yet.
        <NuxtLink to="/lobby" class="text-ability no-underline hover:text-chaff"
          >Be the first.</NuxtLink
        >
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full border-collapse text-xs">
          <caption class="sr-only">
            Top players ranked by rating
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                #
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Player
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Rating
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Rank
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                W
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                L
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Win%
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in players"
              :key="p.id"
              :class="{ 'bg-ability/10 font-bold': p.id === meId }"
              :data-self="p.id === meId ? 'true' : undefined"
            >
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ p.rank }}</td>
              <th scope="row" class="border-b border-border/50 px-1.5 py-1 text-left font-normal">
                <span
                  v-if="p.guildTag"
                  class="mr-1 border border-ability/50 px-1 font-mono text-[0.6rem] text-ability"
                  data-testid="leaderboard-guild-tag"
                  >{{ p.guildTag }}</span
                >
                <NuxtLink :to="`/profile/${p.id}`" class="text-ability">{{ p.username }}</NuxtLink>
                <span v-if="p.id === meId" class="ml-1 text-[0.65rem] text-chaff">
                  &lt; you<span class="sr-only"> (this is your rank)</span>
                </span>
              </th>
              <td class="border-b border-border/50 px-1.5 py-1 font-bold text-gold">{{ p.mmr }}</td>
              <td
                class="border-b border-border/50 px-1.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide text-ability"
              >
                {{ p.rankName }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-1 text-chaff">{{ p.wins }}</td>
              <td class="border-b border-border/50 px-1.5 py-1 text-audit">
                {{ p.gamesPlayed - p.wins }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-1">{{ p.winRate }}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </TerminalPanel>
  </div>
</template>
