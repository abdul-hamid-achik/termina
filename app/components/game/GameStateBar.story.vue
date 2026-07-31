<script setup lang="ts">
import { SAMPLE_HERO_ID, makeTerminal, makeTeamState } from '~/stories/fixtures'
import GameStateBar from './GameStateBar.vue'

// The top bar: self state (cycle number, scrip, KDA, connection) plus an
// always-on macro row (team kills, net-worth lead, ice, Terminal INTEG).
// NOTE: the bar shows NO cycle countdown — the status line is the game's
// single clock (the countdown props were removed in the HUD declutter).
const teams = { chaff: makeTeamState('chaff'), audit: makeTeamState('audit') }
const terminals = { chaff: makeTerminal('chaff'), audit: makeTerminal('audit') }

const base = {
  cycle: 240,
  gameTime: '16:00',
  scrip: 1840,
  kills: 6,
  deaths: 2,
  assists: 9,
  heroId: SAMPLE_HERO_ID,
  netWorthChaff: 5400,
  netWorthAudit: 4500,
}
</script>

<template>
  <Story title="Game/GameStateBar">
    <!-- Online, day, chaff ahead. -->
    <Variant title="online (day, chaff ahead)">
      <div class="bg-bg-primary" style="width: 820px">
        <GameStateBar
          v-bind="base"
          :connected="true"
          :latency="38"
          time-of-day="day"
          :day-night-cycle="12"
          :teams="teams"
          :terminals="terminals"
        />
      </div>
    </Variant>

    <!-- Night, reconnecting banner, audit ahead, Terminal under threat. -->
    <Variant title="reconnecting (night, core vulnerable)">
      <div class="bg-bg-primary" style="width: 820px">
        <GameStateBar
          v-bind="base"
          :reconnecting="true"
          time-of-day="night"
          :day-night-cycle="6"
          :net-worth-chaff="4200"
          :net-worth-audit="6100"
          :teams="{
            chaff: makeTeamState('chaff', { kills: 9, iceKills: 1 }),
            audit: makeTeamState('audit', { kills: 18, iceKills: 4 }),
          }"
          :terminals="{
            chaff: makeTerminal('chaff', { integ: 900, maxInteg: 4500, vulnerable: true }),
            audit: makeTerminal('audit'),
          }"
        />
      </div>
    </Variant>

    <!-- Offline, no macro row (early game / no team data yet). -->
    <Variant title="offline (self row only)">
      <div class="bg-bg-primary" style="width: 820px">
        <GameStateBar v-bind="base" :connected="false" :teams="null" :terminals="null" />
      </div>
    </Variant>
  </Story>
</template>
