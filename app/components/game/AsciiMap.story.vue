<script setup lang="ts">
import type { ZoneDisplay } from './asciiMapModel'
import { makeAncient } from '~/stories/fixtures'
import AsciiMap from './AsciiMap.vue'

// AsciiMap renders the 5x10 zone grid (desktop) or a zone-centered card stack
// (compact). It takes pre-computed ZoneDisplay rows + the player's zone +
// ancients. We seed a realistic spread: player mid, allies/enemies scattered,
// a downed tower, fogged enemy jungle, and creep/neutral counts.
function zone(id: string, name: string, overrides: Partial<ZoneDisplay> = {}): ZoneDisplay {
  return { id, name, playerHere: false, allies: [], enemyCount: 0, fogged: false, ...overrides }
}

const zones: ZoneDisplay[] = [
  zone('mid-river', 'Mid River', { playerHere: true, allies: ['kernel_main'] }),
  zone('top-river', 'Top River', { enemyCount: 2, enemyNames: ['daemon_carry', 'regex_mid'] }),
  zone('bot-river', 'Bot River', { creepCount: 4, creepTypes: ['melee', 'ranged'] }),
  zone('rune-top', 'Top Rune', {}),
  zone('roshan-pit', 'Roshan Pit', { neutralCount: 1 }),
  zone('mid-t1-dire', 'Dire Mid T1', {
    tower: { team: 'dire', alive: true, tier: 1, hp: 720, maxHp: 1800 },
  }),
  zone('mid-t1-rad', 'Radiant Mid T1', {
    tower: { team: 'radiant', alive: false, tier: 1 },
  }),
  zone('jungle-rad-top', 'Radiant Jungle (Top)', { neutralCount: 3, allies: ['proxy_jg'] }),
  zone('jungle-dire-bot', 'Dire Jungle (Bot)', { fogged: true, enemyCount: 1 }),
  zone('radiant-base', 'Radiant Base', {}),
  zone('dire-base', 'Dire Base', {}),
]

const ancients = {
  radiant: makeAncient('radiant'),
  dire: makeAncient('dire', { hp: 1800, maxHp: 4500, vulnerable: true }),
}
</script>

<template>
  <Story title="Game/AsciiMap">
    <!-- Desktop 5x10 grid (forced full mode for a stable story render). -->
    <Variant title="full grid (desktop)">
      <div class="bg-bg-primary p-2" style="width: 760px; height: 620px">
        <AsciiMap :zones="zones" player-zone="mid-river" :ancients="ancients" force-mode="full" />
      </div>
    </Variant>

    <!-- Compact zone-centered cards (mobile): current zone + tappable adjacents. -->
    <Variant title="compact (mobile)">
      <div class="bg-bg-primary p-2" style="width: 360px; height: 600px">
        <AsciiMap
          :zones="zones"
          player-zone="mid-river"
          :ancients="ancients"
          force-mode="compact"
        />
      </div>
    </Variant>

    <!-- Loading state: no zone data yet. -->
    <Variant title="loading (no zones)">
      <div class="bg-bg-primary p-2" style="width: 760px; height: 200px">
        <AsciiMap :zones="[]" player-zone="" force-mode="full" />
      </div>
    </Variant>
  </Story>
</template>
