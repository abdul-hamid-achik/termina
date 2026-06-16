<script setup lang="ts">
import type { FoggedPlayer, PlayerState } from '~~/shared/types/game'
import { SAMPLE_HEROES, makePlayer } from '~/stories/fixtures'
import EnemyThreatSheet from './EnemyThreatSheet.vue'

// The sheet shows enemy intel: visible enemies get HP/MP bars + ability
// cooldowns; fogged enemies show only last-seen; dead enemies show a respawn
// timer. `lastSeen` is keyed by player id.
const TICK = 240

const visible: PlayerState[] = [
  makePlayer({
    id: 'e1',
    name: 'daemon_carry',
    team: 'dire',
    heroId: SAMPLE_HEROES.daemon,
    hp: 620,
    maxHp: 880,
    mp: 240,
    maxMp: 420,
    level: 11,
    cooldowns: { q: 0, w: 3, e: 0, r: 9 },
  }),
  makePlayer({
    id: 'e2',
    name: 'regex_mid',
    team: 'dire',
    heroId: SAMPLE_HEROES.regex,
    hp: 140,
    maxHp: 560,
    mp: 60,
    maxMp: 320,
    level: 9,
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
  }),
]

const fogged: FoggedPlayer = {
  id: 'e3',
  name: 'cache_sup',
  team: 'dire',
  heroId: SAMPLE_HEROES.cache,
  level: 7,
  kills: 1,
  deaths: 5,
  assists: 9,
  alive: true,
  fogged: true,
}

const dead: PlayerState = makePlayer({
  id: 'e4',
  name: 'firewall_tank',
  team: 'dire',
  heroId: SAMPLE_HEROES.firewall,
  level: 8,
  alive: false,
  hp: 0,
  respawnTick: TICK + 18,
})

const lastSeen: Record<string, { zone: string; tick: number }> = {
  e3: { zone: 'dire-jungle', tick: TICK - 6 },
}

const mixed = [visible[0]!, visible[1]!, fogged, dead]
</script>

<template>
  <Story title="Game/EnemyThreatSheet" :layout="{ type: 'grid', width: 280 }">
    <Variant title="all visible">
      <div class="bg-bg-primary p-2" style="width: 240px">
        <EnemyThreatSheet :enemies="visible" :last-seen="{}" :tick="TICK" />
      </div>
    </Variant>

    <Variant title="mixed (visible · fogged · dead)">
      <div class="bg-bg-primary p-2" style="width: 240px">
        <EnemyThreatSheet :enemies="mixed" :last-seen="lastSeen" :tick="TICK" />
      </div>
    </Variant>

    <Variant title="no intel (empty)">
      <div class="bg-bg-primary p-2" style="width: 240px">
        <EnemyThreatSheet :enemies="[]" :last-seen="{}" :tick="TICK" />
      </div>
    </Variant>
  </Story>
</template>
