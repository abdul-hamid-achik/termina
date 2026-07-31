<script setup lang="ts">
import {
  SAMPLE_ITEMS,
  makeScoreboard,
  makeScoreboardEntry,
  makeTeamState,
} from '~/stories/fixtures'
import Scoreboard from './Scoreboard.vue'

const teams = { chaff: makeTeamState('chaff'), audit: makeTeamState('audit') }

// Full mid-game board (p1 is "you" / self-highlighted, one audit player dead).
const midGame = makeScoreboard()

// Same board but every enemy (audit) is fogged: scrip/items hidden as ???.
const fogged = makeScoreboard().map((p) =>
  p.team === 'audit' ? makeScoreboardEntry({ ...p, fogged: true }) : p,
)

// Early game: everyone alive, low scrip, no items yet, even kills.
const earlyTeams = {
  chaff: makeTeamState('chaff', { kills: 0, iceKills: 0, scrip: 1800 }),
  audit: makeTeamState('audit', { kills: 0, iceKills: 0, scrip: 1800 }),
}
const earlyGame = makeScoreboard().map((p) =>
  makeScoreboardEntry({
    ...p,
    kills: 0,
    deaths: 0,
    assists: 0,
    level: 1,
    scrip: 600,
    items: [null, null, null, null, null, null],
    alive: true,
    respawnCycle: null,
    fogged: false,
  }),
)

// A blowout where audit is being closed out (dead, full builds on chaff).
const stompTeams = {
  chaff: makeTeamState('chaff', { kills: 38, iceKills: 9, scrip: 14_200 }),
  audit: makeTeamState('audit', { kills: 7, iceKills: 0, scrip: 4100 }),
}
const fullBuild = [
  SAMPLE_ITEMS.killshot_coil,
  SAMPLE_ITEMS.bkb,
  SAMPLE_ITEMS.treads,
  SAMPLE_ITEMS.rust_driver,
  SAMPLE_ITEMS.blink,
  SAMPLE_ITEMS.forceStaff,
]
const stomp = makeScoreboard().map((p) =>
  p.team === 'chaff'
    ? makeScoreboardEntry({ ...p, kills: p.kills + 6, scrip: 16_800, level: 25, items: fullBuild })
    : makeScoreboardEntry({ ...p, alive: false, respawnCycle: 320, deaths: p.deaths + 4 }),
)

// One ally went AFK and was replaced by a bot — flagged with an [AI] tag.
const afkTakeover = makeScoreboard().map((p, i) =>
  p.team === 'chaff' && i === 1 ? makeScoreboardEntry({ ...p, aiControlled: true }) : p,
)
</script>

<template>
  <Story title="Game/Scoreboard">
    <Variant title="mid-game">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard :players="midGame" :teams="teams" :current-cycle="240" current-player-id="p1" />
      </div>
    </Variant>

    <Variant title="enemies fogged">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard :players="fogged" :teams="teams" :current-cycle="240" current-player-id="p1" />
      </div>
    </Variant>

    <Variant title="early game (empty builds)">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard
          :players="earlyGame"
          :teams="earlyTeams"
          :current-cycle="15"
          current-player-id="p1"
        />
      </div>
    </Variant>

    <Variant title="blowout (audit dead)">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard
          :players="stomp"
          :teams="stompTeams"
          :current-cycle="525"
          current-player-id="p1"
        />
      </div>
    </Variant>

    <Variant title="ally replaced by bot (AFK)">
      <div class="bg-bg-primary" style="width: 760px">
        <Scoreboard
          :players="afkTakeover"
          :teams="teams"
          :current-cycle="240"
          current-player-id="p1"
        />
      </div>
    </Variant>
  </Story>
</template>
