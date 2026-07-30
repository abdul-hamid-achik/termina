<script setup lang="ts">
import { makeTenant, makeCache } from '~/stories/fixtures'

import ObjectiveTicker from './ObjectiveTicker.vue'

const TICK = 240
</script>

<template>
  <Story title="Game/ObjectiveTicker" :layout="{ type: 'grid', width: 240 }">
    <!-- Rosh up, a live cache, no backup. Cache types render through buffLabel:
         'dd' shows as "Double Damage", never the raw id. -->
    <Variant title="all live">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :tenant="makeTenant()"
          :caches="[makeCache({ type: 'dd', tick: TICK })]"
          :backup="null"
          :tick="TICK"
        />
      </div>
    </Variant>

    <!-- Tenant dead → respawn countdown; cache still pending. -->
    <Variant title="tenant dead, cache pending">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :tenant="makeTenant({ alive: false, hp: 0, deathTick: TICK - 30 })"
          :caches="[]"
          :backup="null"
          :tick="TICK"
        />
      </div>
    </Variant>

    <!-- Backup claimed by a carrier, ticking down; 'haste' cache → "Haste". -->
    <Variant title="backup held">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :tenant="makeTenant({ alive: false, hp: 0, deathTick: TICK - 5 })"
          :caches="[makeCache({ type: 'haste', tick: TICK })]"
          :backup="{ zone: 'hollow', tick: TICK - 5, holderId: 'p1' }"
          :backup-holder="{ name: 'you', ticksRemaining: 18 }"
          :tick="TICK"
        />
      </div>
    </Variant>

    <!-- Backup dropped in the pit (no carrier yet). -->
    <Variant title="backup in pit">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :tenant="makeTenant({ alive: false, hp: 0, deathTick: TICK - 2 })"
          :caches="[]"
          :backup="{ zone: 'hollow', tick: TICK - 2, holderId: null }"
          :tick="TICK"
        />
      </div>
    </Variant>
  </Story>
</template>
