<script setup lang="ts">
import type { PlayerState } from '~~/shared/types/game'
import { SAMPLE_HERO_ID, SAMPLE_HEROES, SAMPLE_ITEMS, makePlayer } from '~/stories/fixtures'
import HeroStatus from './HeroStatus.vue'

// HeroStatus takes a flattened `HeroData` view (a subset of PlayerState) plus a
// `heroId` for the avatar + ability defs. We derive that view from the shared
// makePlayer() fixture so the numbers match what the live game produces.
function heroFrom(p: PlayerState) {
  return {
    name: p.name,
    level: p.level,
    zone: p.zone,
    hp: p.hp,
    maxHp: p.maxHp,
    mp: p.mp,
    maxMp: p.maxMp,
    cooldowns: p.cooldowns,
    items: p.items,
    buffs: p.buffs,
    gold: p.gold,
    alive: p.alive,
  }
}

const midGame = heroFrom(
  makePlayer({
    name: 'echo_mid',
    cooldowns: { q: 0, w: 2, e: 0, r: 8 },
    items: [SAMPLE_ITEMS.treads, SAMPLE_ITEMS.bkb, null, null, null, null],
  }),
)

const allReady = heroFrom(
  makePlayer({
    name: 'ready_to_fight',
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    items: [SAMPLE_ITEMS.blades, SAMPLE_ITEMS.salve, null, null, null, null],
  }),
)

const fullBuild = heroFrom(
  makePlayer({
    name: 'six_slotted',
    level: 25,
    gold: 18_400,
    hp: 2400,
    maxHp: 2400,
    mp: 1100,
    maxMp: 1200,
    items: [
      SAMPLE_ITEMS.daedalus,
      SAMPLE_ITEMS.bkb,
      SAMPLE_ITEMS.treads,
      SAMPLE_ITEMS.desolator,
      SAMPLE_ITEMS.blink,
      SAMPLE_ITEMS.forceStaff,
    ],
    buffs: [
      { id: 'bkb', stacks: 1, ticksRemaining: 6, source: 'item', destination: 'p1' },
      { id: 'haste', stacks: 1, ticksRemaining: 3, source: 'rune', destination: 'p1' },
    ],
  }),
)

const lowHp = heroFrom(
  makePlayer({
    name: 'one_more_hit',
    hp: 64,
    maxHp: 620,
    mp: 12,
    maxMp: 300,
    cooldowns: { q: 4, w: 6, e: 2, r: 11 },
  }),
)

const dead = heroFrom(
  makePlayer({
    name: 'respawning',
    alive: false,
    hp: 0,
    mp: 0,
    cooldowns: { q: 0, w: 0, e: 0, r: 14 },
  }),
)

const noBuild = heroFrom(
  makePlayer({
    name: 'fresh_spawn',
    level: 1,
    gold: 600,
    hp: 560,
    maxHp: 560,
    mp: 280,
    maxMp: 280,
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    items: [null, null, null, null, null, null],
    buffs: [],
  }),
)
</script>

<template>
  <Story title="Game/HeroStatus">
    <Variant title="mid-game">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <HeroStatus :hero="midGame" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="all abilities ready">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <HeroStatus :hero="allReady" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="full build + buffs">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <HeroStatus :hero="fullBuild" :hero-id="SAMPLE_HEROES.daemon" />
      </div>
    </Variant>

    <Variant title="low hp / danger">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <HeroStatus :hero="lowHp" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="dead">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <HeroStatus :hero="dead" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="fresh spawn (empty)">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <HeroStatus :hero="noBuild" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>
  </Story>
</template>
