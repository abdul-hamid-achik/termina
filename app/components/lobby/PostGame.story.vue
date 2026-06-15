<script setup lang="ts">
import type { TeamId } from '~~/shared/types/game'
import type { PlayerEndStats } from '~~/shared/types/protocol'
import { makeRoster, makePlayerEndStats, SAMPLE_INVENTORY } from '~/stories/fixtures'

// Props-driven, with two Nuxt globals exercised: the [WATCH REPLAY] <NuxtLink>
// (stubbed to a passthrough <a> in histoire.setup.ts) and the PLAY AGAIN /
// MAIN MENU buttons. The component itself does NOT call navigateTo — the parent
// page does — so nothing here needs the no-op navigateTo shim.
const ROSTER = Object.values(makeRoster())

const PLAYERS = ROSTER.map((p) => ({
  id: p.id,
  name: p.name,
  heroId: p.heroId ?? '',
  team: p.team,
}))

// End-of-game stat lines keyed by player id; the local player (p1) gets the
// standout numbers so the "Your Performance" panel reads well.
const STATS: Record<string, PlayerEndStats> = {}
for (const p of ROSTER) {
  STATS[p.id] = makePlayerEndStats({
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    gold: p.gold,
    items: p.items.some(Boolean) ? p.items : SAMPLE_INVENTORY,
    heroDamage: 8_000 + p.kills * 2_500,
    towerDamage: p.towerDamageDealt,
  })
}
STATS.p1 = makePlayerEndStats({
  kills: 11,
  deaths: 4,
  assists: 9,
  gold: 14_200,
  items: SAMPLE_INVENTORY,
  heroDamage: 38_400,
  towerDamage: 6_100,
})

const RADIANT: TeamId = 'radiant'
const DIRE: TeamId = 'dire'
</script>

<template>
  <Story title="Lobby/PostGame">
    <!-- Local player (radiant) won: green victory banner, +MMR, replay link. -->
    <Variant title="radiant victory (+mmr)">
      <PostGame
        :winner="RADIANT"
        :stats="STATS"
        :players="PLAYERS"
        current-player-id="p1"
        :mmr-change="27"
        game-id="game_abc123"
        @play-again="() => {}"
        @return-to-menu="() => {}"
      />
    </Variant>

    <!-- Local player lost: red DIRE VICTORY banner, -MMR. -->
    <Variant title="dire victory (-mmr)">
      <PostGame
        :winner="DIRE"
        :stats="STATS"
        :players="PLAYERS"
        current-player-id="p1"
        :mmr-change="-23"
        game-id="game_abc123"
        @play-again="() => {}"
        @return-to-menu="() => {}"
      />
    </Variant>

    <!-- No MMR delta and no replay id: the MMR stat + WATCH REPLAY link are hidden. -->
    <Variant title="no mmr / no replay">
      <PostGame
        :winner="RADIANT"
        :stats="STATS"
        :players="PLAYERS"
        current-player-id="p1"
        :game-id="null"
        @play-again="() => {}"
        @return-to-menu="() => {}"
      />
    </Variant>
  </Story>
</template>
