<script setup lang="ts">
import {
  SAMPLE_ITEMS,
  makeScoreboard,
  makeScoreboardEntry,
  makeTeamState,
} from '~/stories/fixtures'
import Scoreboard from './Scoreboard.vue'

const teams = { radiant: makeTeamState('radiant'), dire: makeTeamState('dire') }

// Full mid-game board (p1 is "you" / self-highlighted, one dire player dead).
const midGame = makeScoreboard()

// Same board but every enemy (dire) is fogged: gold/items hidden as ???.
const fogged = makeScoreboard().map((p) =>
  p.team === 'dire' ? makeScoreboardEntry({ ...p, fogged: true }) : p,
)

// Early game: everyone alive, low gold, no items yet, even kills.
const earlyTeams = {
  radiant: makeTeamState('radiant', { kills: 0, towerKills: 0, gold: 1800 }),
  dire: makeTeamState('dire', { kills: 0, towerKills: 0, gold: 1800 }),
}
const earlyGame = makeScoreboard().map((p) =>
  makeScoreboardEntry({
    ...p,
    kills: 0,
    deaths: 0,
    assists: 0,
    level: 1,
    gold: 600,
    items: [null, null, null, null, null, null],
    alive: true,
    respawnTick: null,
    fogged: false,
  }),
)

// A blowout where dire is being closed out (dead, full builds on radiant).
const stompTeams = {
  radiant: makeTeamState('radiant', { kills: 38, towerKills: 9, gold: 14_200 }),
  dire: makeTeamState('dire', { kills: 7, towerKills: 0, gold: 4100 }),
}
const fullBuild = [
  SAMPLE_ITEMS.daedalus,
  SAMPLE_ITEMS.bkb,
  SAMPLE_ITEMS.treads,
  SAMPLE_ITEMS.desolator,
  SAMPLE_ITEMS.blink,
  SAMPLE_ITEMS.forceStaff,
]
const stomp = makeScoreboard().map((p) =>
  p.team === 'radiant'
    ? makeScoreboardEntry({ ...p, kills: p.kills + 6, gold: 16_800, level: 25, items: fullBuild })
    : makeScoreboardEntry({ ...p, alive: false, respawnTick: 320, deaths: p.deaths + 4 }),
)
</script>

<template>
  <Story title="Game/Scoreboard">
    <Variant title="mid-game">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard :players="midGame" :teams="teams" :current-tick="240" current-player-id="p1" />
      </div>
    </Variant>

    <Variant title="enemies fogged">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard :players="fogged" :teams="teams" :current-tick="240" current-player-id="p1" />
      </div>
    </Variant>

    <Variant title="early game (empty builds)">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard
          :players="earlyGame"
          :teams="earlyTeams"
          :current-tick="15"
          current-player-id="p1"
        />
      </div>
    </Variant>

    <Variant title="blowout (dire dead)">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard
          :players="stomp"
          :teams="stompTeams"
          :current-tick="525"
          current-player-id="p1"
        />
      </div>
    </Variant>
  </Story>
</template>
