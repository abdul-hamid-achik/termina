<script setup lang="ts">
import { ITEMS } from '~~/shared/constants/items'
import { makePlayer, makeRoster, makeZone } from '~/stories/fixtures'
import CommandInput from './CommandInput.vue'

// The autocomplete/validation pulls from the player, visible zones, roster and
// item table — wire all of them so the suggestions + inline preview are live.
const player = makePlayer({ zone: 'mid-river', scrip: 1800 })
const allPlayers = makeRoster()
const visibleZones = {
  'mid-river': makeZone('mid-river'),
  'top-river': makeZone('top-river'),
  'bot-river': makeZone('bot-river'),
  'mid-t1-audit': makeZone('mid-t1-audit'),
}
const TICK = 240
</script>

<template>
  <Story title="Game/CommandInput">
    <!-- Live prompt: can act, full context for suggestions + inline preview.
         (No countdown/WAITING footer here anymore — the status line is
         the game's single clock; waiting is conveyed via the placeholder and
         the queued/buffered states below.) -->
    <Variant title="ready (can act)">
      <div class="bg-bg-primary" style="width: 520px">
        <CommandInput
          :player="player"
          :visible-zones="visibleZones"
          :all-players="allPlayers"
          :items="ITEMS"
          :cycle="TICK"
          :can-act="true"
        />
      </div>
    </Variant>

    <!-- Action already sent this cycle: prompt stays hot for pre-typing. -->
    <Variant title="waiting (action sent)">
      <div class="bg-bg-primary" style="width: 520px">
        <CommandInput
          :player="player"
          :visible-zones="visibleZones"
          :all-players="allPlayers"
          :items="ITEMS"
          :cycle="TICK"
          :can-act="false"
          pending-command="move top-river"
        />
      </div>
    </Variant>

    <!-- A command buffered while waiting — sends next cycle. -->
    <Variant title="buffered command">
      <div class="bg-bg-primary" style="width: 520px">
        <CommandInput
          :player="player"
          :visible-zones="visibleZones"
          :all-players="allPlayers"
          :items="ITEMS"
          :cycle="TICK"
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
          :cycle="TICK"
          disabled
          placeholder="You are dead — buyback or wait"
        />
      </div>
    </Variant>
  </Story>
</template>
