<script setup lang="ts">
import { SAMPLE_HERO_ID, makeAncient, makeTeamState } from '~/stories/fixtures'
import GameStateBar from './GameStateBar.vue'

// The top bar: self state (tick heartbeat, gold, KDA, connection) plus an
// always-on macro row (team kills, net-worth lead, towers, Core HP).
const teams = { radiant: makeTeamState('radiant'), dire: makeTeamState('dire') }
const ancients = { radiant: makeAncient('radiant'), dire: makeAncient('dire') }

const base = {
  tick: 240,
  gameTime: '16:00',
  gold: 1840,
  kills: 6,
  deaths: 2,
  assists: 9,
  heroId: SAMPLE_HERO_ID,
  netWorthRadiant: 5400,
  netWorthDire: 4500,
}
</script>

<template>
  <Story title="Game/GameStateBar">
    <!-- Online, day, radiant ahead, mid tick countdown. -->
    <Variant title="online (day, radiant ahead)">
      <div class="bg-bg-primary" style="width: 820px">
        <GameStateBar
          v-bind="base"
          :connected="true"
          :latency="38"
          time-of-day="day"
          :day-night-tick="12"
          :next-tick-in="2400"
          :teams="teams"
          :ancients="ancients"
        />
      </div>
    </Variant>

    <!-- Night, reconnecting banner, dire ahead, Core under threat. -->
    <Variant title="reconnecting (night, core vulnerable)">
      <div class="bg-bg-primary" style="width: 820px">
        <GameStateBar
          v-bind="base"
          :reconnecting="true"
          time-of-day="night"
          :day-night-tick="6"
          :next-tick-in="900"
          :net-worth-radiant="4200"
          :net-worth-dire="6100"
          :teams="{
            radiant: makeTeamState('radiant', { kills: 9, towerKills: 1 }),
            dire: makeTeamState('dire', { kills: 18, towerKills: 4 }),
          }"
          :ancients="{
            radiant: makeAncient('radiant', { hp: 900, maxHp: 4500, vulnerable: true }),
            dire: makeAncient('dire'),
          }"
        />
      </div>
    </Variant>

    <!-- Offline, no macro row (early game / no team data yet). -->
    <Variant title="offline (self row only)">
      <div class="bg-bg-primary" style="width: 820px">
        <GameStateBar v-bind="base" :connected="false" :teams="null" :ancients="null" />
      </div>
    </Variant>
  </Story>
</template>
