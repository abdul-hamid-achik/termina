<script setup lang="ts">
import { makeTenant, makeRune } from '~/stories/fixtures'

import ObjectiveTicker from './ObjectiveTicker.vue'

const TICK = 240
</script>

<template>
  <Story title="Game/ObjectiveTicker" :layout="{ type: 'grid', width: 240 }">
    <!-- Rosh up, a live rune, no backup. Rune types render through buffLabel:
         'dd' shows as "Double Damage", never the raw id. -->
    <Variant title="all live">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :tenant="makeTenant()"
          :runes="[makeRune({ type: 'dd', tick: TICK })]"
          :backup="null"
          :tick="TICK"
        />
      </div>
    </Variant>

    <!-- Tenant dead → respawn countdown; rune still pending. -->
    <Variant title="tenant dead, rune pending">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :tenant="makeTenant({ alive: false, hp: 0, deathTick: TICK - 30 })"
          :runes="[]"
          :backup="null"
          :tick="TICK"
        />
      </div>
    </Variant>

    <!-- Backup claimed by a carrier, ticking down; 'haste' rune → "Haste". -->
    <Variant title="backup held">
      <div class="bg-bg-primary p-2" style="width: 200px">
        <ObjectiveTicker
          :tenant="makeTenant({ alive: false, hp: 0, deathTick: TICK - 5 })"
          :runes="[makeRune({ type: 'haste', tick: TICK })]"
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
          :runes="[]"
          :backup="{ zone: 'hollow', tick: TICK - 2, holderId: null }"
          :tick="TICK"
        />
      </div>
    </Variant>
  </Story>
</template>
