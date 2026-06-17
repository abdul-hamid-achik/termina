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
  zone('rune-top', 'Top Rune', { wardCount: 1, runeType: 'haste' }),
  zone('roshan-pit', 'Roshan Pit', { neutralCount: 1, roshan: { alive: false, respawnIn: 48 } }),
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

// One-lane map (mapId='one_lane'): a single mid-lane column. Same ZoneDisplay
// shape, but AsciiMap lays it out as 11 stacked cells instead of the 5x10 grid.
const oneLaneZones: ZoneDisplay[] = [
  zone('radiant-fountain', 'Radiant Fountain', {}),
  zone('radiant-base', 'Radiant Base', {}),
  zone('mid-t3-rad', 'Radiant Mid T3', {
    tower: { team: 'radiant', alive: true, tier: 3, hp: 2000, maxHp: 2000 },
  }),
  zone('mid-t2-rad', 'Radiant Mid T2', {
    tower: { team: 'radiant', alive: true, tier: 2, hp: 1200, maxHp: 1900 },
  }),
  zone('mid-t1-rad', 'Radiant Mid T1', {
    tower: { team: 'radiant', alive: false, tier: 1 },
    allies: ['kernel_main'],
  }),
  zone('mid-river', 'Mid River', { playerHere: true, creepCount: 4 }),
  zone('mid-t1-dire', 'Dire Mid T1', {
    tower: { team: 'dire', alive: true, tier: 1, hp: 720, maxHp: 1800 },
    enemyCount: 2,
    enemyNames: ['daemon_carry', 'regex_mid'],
  }),
  zone('mid-t2-dire', 'Dire Mid T2', {
    tower: { team: 'dire', alive: true, tier: 2, hp: 1900, maxHp: 1900 },
    fogged: true,
  }),
  zone('mid-t3-dire', 'Dire Mid T3', {
    tower: { team: 'dire', alive: true, tier: 3, hp: 2000, maxHp: 2000 },
    fogged: true,
  }),
  zone('dire-base', 'Dire Base', { fogged: true }),
  zone('dire-fountain', 'Dire Fountain', { fogged: true }),
]
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

    <!-- One-lane map: single mid-lane column (map-id drives the layout). -->
    <Variant title="one-lane (full)">
      <div class="bg-bg-primary p-2" style="width: 760px; height: 620px">
        <AsciiMap
          :zones="oneLaneZones"
          player-zone="mid-river"
          :ancients="ancients"
          map-id="one_lane"
          force-mode="full"
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
