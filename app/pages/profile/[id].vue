<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { formatGameMode, matchResult } from '~~/shared/matchFormat'
import { topHeroStats } from '~~/shared/heroStatsView'
import type { HeroStatRow } from '~~/shared/heroStatsView'
import { HEROES } from '~~/shared/constants/heroes'
import { formatTickClock } from '~/utils/gameClock'

const route = useRoute()
const authStore = useAuthStore()

const playerId = computed(() => {
  const id = route.params.id as string
  return id === 'me' ? (authStore.user?.id ?? '') : id
})

const isOwnProfile = computed(() => {
  return authStore.user?.id === playerId.value
})

interface ProfilePlayer {
  id: string
  username: string
  avatarUrl: string | null
  selectedAvatar: string | null
  mmr: number
  gamesPlayed: number
  wins: number
  createdAt: string | null
}

interface MatchSummary {
  id: string
  mode: string
  winner: 'radiant' | 'dire' | null
  team: 'radiant' | 'dire' | null
  durationTicks: number | null
  createdAt: string | null
}

const { data: profileData, status: profileStatus } = await useFetch(
  () => `/api/player/${playerId.value}`,
  {
    watch: [playerId],
  },
)

const { data: matchData } = await useFetch(() => `/api/match/history?player=${playerId.value}`, {
  watch: [playerId],
})

const player = computed<ProfilePlayer | null>(
  () => (profileData.value as { player?: ProfilePlayer } | null)?.player ?? null,
)
const recentMatches = computed<MatchSummary[]>(
  () => (matchData.value as { matches?: MatchSummary[] } | null)?.matches ?? [],
)

// Most-played heroes (public per-hero record) — sorted + win-rate/KDA computed
// by the pure shared helper.
const heroStats = computed(() =>
  topHeroStats((profileData.value as { heroStats?: HeroStatRow[] } | null)?.heroStats ?? []),
)
function heroName(id: string): string {
  return HEROES[id]?.name ?? id
}

// Decorate each match with the player-perspective result (Victory/Defeat/In
// Progress) so the template doesn't recompute it per cell.
const decoratedMatches = computed(() =>
  recentMatches.value.map((m) => ({ ...m, result: matchResult(m.winner, m.team) })),
)

function formatDuration(ticks: number | null): string {
  return ticks ? formatTickClock(ticks) : '--:--'
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleDateString()
}
</script>

<template>
  <div class="mx-auto mt-6 flex max-w-[600px] flex-col gap-4">
    <div v-if="profileStatus === 'pending'" class="py-10 text-center text-[0.85rem] text-text-dim">
      Loading profile<span class="animate-blink">_</span>
    </div>

    <div v-else-if="!player" class="py-10 text-center">
      <TerminalPanel title="Error">
        <p class="p-4 text-[0.85rem] text-dire">Player not found.</p>
      </TerminalPanel>
    </div>

    <template v-else>
      <TerminalPanel title="Player Profile">
        <div class="mb-3 flex items-center justify-between border-b border-border pb-3">
          <div class="flex items-center gap-3">
            <ClientOnly>
              <HeroAvatar
                v-if="player.selectedAvatar"
                :hero-id="player.selectedAvatar"
                :size="48"
              />
            </ClientOnly>
            <span class="text-[0.8rem] text-text-dim">&gt;_ whois {{ player.username }}</span>
          </div>
          <NuxtLink
            v-if="isOwnProfile"
            to="/profile/settings"
            class="text-[0.75rem] text-ability no-underline hover:text-radiant"
          >
            [EDIT]
          </NuxtLink>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex gap-2 text-[0.85rem]">
            <span class="min-w-[80px] text-text-dim">Rating:</span>
            <span class="font-bold text-gold">{{ player.mmr ?? 1000 }}</span>
          </div>
          <div class="flex gap-2 text-[0.85rem]">
            <span class="min-w-[80px] text-text-dim">Games:</span>
            <span class="text-text-primary">{{ player.gamesPlayed ?? 0 }}</span>
          </div>
          <div class="flex gap-2 text-[0.85rem]">
            <span class="min-w-[80px] text-text-dim">Record:</span>
            <span class="text-text-primary">
              <span class="text-radiant">{{ player.wins ?? 0 }}W</span>
              /
              <span class="text-dire">{{ (player.gamesPlayed ?? 0) - (player.wins ?? 0) }}L</span>
              <template v-if="player.gamesPlayed > 0">
                ({{ ((player.wins / player.gamesPlayed) * 100).toFixed(1) }}%)
              </template>
            </span>
          </div>
          <div class="flex gap-2 text-[0.85rem]">
            <span class="min-w-[80px] text-text-dim">Joined:</span>
            <span class="text-text-primary">{{ formatDate(player.createdAt) }}</span>
          </div>
        </div>
      </TerminalPanel>

      <TerminalPanel v-if="heroStats.length > 0" title="Most Played Heroes">
        <table class="w-full border-collapse text-xs">
          <caption class="sr-only">
            Most played heroes by games, with win rate and average KDA
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Hero
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Games
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Win%
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                KDA
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in heroStats" :key="h.heroId" data-testid="hero-stat-row">
              <th scope="row" class="border-b border-border/50 px-1.5 py-1 text-left font-normal">
                <!-- Funnel: a hero you play → train its kit on /heroes. -->
                <NuxtLink
                  :to="`/heroes?hero=${h.heroId}`"
                  class="text-ability no-underline hover:text-radiant"
                  :aria-label="`Train ${heroName(h.heroId)} in the hero console`"
                >
                  {{ heroName(h.heroId) }}
                </NuxtLink>
              </th>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ h.games }}</td>
              <td
                class="border-b border-border/50 px-1.5 py-1"
                :class="h.winRate >= 50 ? 'text-radiant' : 'text-dire'"
              >
                {{ h.winRate }}%
              </td>
              <td class="border-b border-border/50 px-1.5 py-1 text-gold">{{ h.kda }}</td>
            </tr>
          </tbody>
        </table>
      </TerminalPanel>

      <TerminalPanel title="Recent Matches">
        <div v-if="recentMatches.length === 0" class="py-4 text-center text-[0.8rem] text-text-dim">
          No matches played yet.
        </div>
        <table v-else class="w-full border-collapse text-xs">
          <caption class="sr-only">
            Recent matches — mode, result, duration and date
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Mode
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Result
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Duration
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Date
              </th>
              <th
                scope="col"
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Watch
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in decoratedMatches" :key="m.id">
              <th
                scope="row"
                class="border-b border-border/50 px-1.5 py-1 text-left font-normal text-ability"
              >
                {{ formatGameMode(m.mode) }}
              </th>
              <td
                class="border-b border-border/50 px-1.5 py-1 font-bold"
                :class="{
                  'text-radiant': m.result === 'Victory',
                  'text-dire': m.result === 'Defeat',
                  'text-text-dim': m.result === 'In Progress',
                }"
              >
                {{ m.result }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">
                {{ formatDuration(m.durationTicks) }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">
                {{ formatDate(m.createdAt) }}
              </td>
              <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1">
                <NuxtLink
                  v-if="m.winner"
                  :to="`/replay/${m.id}`"
                  class="text-ability no-underline hover:text-radiant"
                  >[replay]</NuxtLink
                >
                <NuxtLink
                  v-else
                  :to="`/spectate/${m.id}`"
                  class="text-warn no-underline hover:text-radiant"
                  >[spectate]</NuxtLink
                >
              </td>
            </tr>
          </tbody>
        </table>
      </TerminalPanel>
    </template>
  </div>
</template>
