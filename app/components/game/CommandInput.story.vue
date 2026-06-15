<script setup lang="ts">
import { ITEMS } from '~~/shared/constants/items'
import { makePlayer, makeRoster, makeZone } from '~/stories/fixtures'
import CommandInput from './CommandInput.vue'

// The autocomplete/validation pulls from the player, visible zones, roster and
// item table — wire all of them so the suggestions + inline preview are live.
const player = makePlayer({ zone: 'mid-river', gold: 1800 })
const allPlayers = makeRoster()
const visibleZones = {
  'mid-river': makeZone('mid-river'),
  'top-river': makeZone('top-river'),
  'bot-river': makeZone('bot-river'),
  'mid-t1-dire': makeZone('mid-t1-dire'),
}
const TICK = 240
</script>

<template>
  <Story title="Game/CommandInput">
    <!-- Live prompt: can act, countdown ticking, full context for suggestions. -->
    <Variant title="ready (can act)">
      <div class="bg-bg-primary" style="width: 520px">
        <CommandInput
          :player="player"
          :visible-zones="visibleZones"
          :all-players="allPlayers"
          :items="ITEMS"
          :tick="TICK"
          :tick-countdown="2600"
          :can-act="true"
        />
      </div>
    </Variant>

    <!-- Action already sent this tick: prompt stays hot for pre-typing. -->
    <Variant title="waiting (action sent)">
      <div class="bg-bg-primary" style="width: 520px">
        <CommandInput
          :player="player"
          :visible-zones="visibleZones"
          :all-players="allPlayers"
          :items="ITEMS"
          :tick="TICK"
          :tick-countdown="1400"
          :can-act="false"
          pending-command="move top-river"
        />
      </div>
    </Variant>

    <!-- A command buffered while waiting — sends next tick. -->
    <Variant title="buffered command">
      <div class="bg-bg-primary" style="width: 520px">
        <CommandInput
          :player="player"
          :visible-zones="visibleZones"
          :all-players="allPlayers"
          :items="ITEMS"
          :tick="TICK"
          :can-act="false"
          buffered-command="cast r"
        />
      </div>
    </Variant>

    <!-- Disabled (e.g. dead / spectating). -->
    <Variant title="disabled">
      <div class="bg-bg-primary" style="width: 520px">
        <CommandInput
          :player="player"
          :items="ITEMS"
          :tick="TICK"
          disabled
          placeholder="You are dead — buyback or wait"
        />
      </div>
    </Variant>
  </Story>
</template>
