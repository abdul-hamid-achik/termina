<script setup lang="ts">
import { makeRoshan, makeRune } from '~/stories/fixtures'

import ObjectiveTicker from './ObjectiveTicker.vue'

const TICK = 240
</script>

<template>
  <Story title="Game/ObjectiveTicker" :layout="{ type: 'grid', width: 240 }">
    <!-- Rosh up, a live rune in pit, no aegis. -->
    <Variant title="all live">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :roshan="makeRoshan()"
          :runes="[makeRune({ type: 'dd', tick: TICK })]"
          :aegis="null"
          :tick="TICK"
        />
      </div>
    </Variant>

    <!-- Roshan dead → respawn countdown; rune still pending. -->
    <Variant title="roshan dead, rune pending">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :roshan="makeRoshan({ alive: false, hp: 0, deathTick: TICK - 30 })"
          :runes="[]"
          :aegis="null"
          :tick="TICK"
        />
      </div>
    </Variant>

    <!-- Aegis claimed by a carrier, ticking down. -->
    <Variant title="aegis held">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :roshan="makeRoshan({ alive: false, hp: 0, deathTick: TICK - 5 })"
          :runes="[makeRune({ type: 'haste', tick: TICK })]"
          :aegis="{ zone: 'roshan-pit', tick: TICK - 5, holderId: 'p1' }"
          :aegis-holder="{ name: 'you', ticksRemaining: 18 }"
          :tick="TICK"
        />
      </div>
    </Variant>

    <!-- Aegis dropped in the pit (no carrier yet). -->
    <Variant title="aegis in pit">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :roshan="makeRoshan({ alive: false, hp: 0, deathTick: TICK - 2 })"
          :runes="[]"
          :aegis="{ zone: 'roshan-pit', tick: TICK - 2, holderId: null }"
          :tick="TICK"
        />
      </div>
    </Variant>
  </Story>
</template>
