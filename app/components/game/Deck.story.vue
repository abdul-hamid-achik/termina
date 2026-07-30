<script setup lang="ts">
import type { PlayerState } from '~~/shared/types/game'
import { SAMPLE_HERO_ID, SAMPLE_HEROES, SAMPLE_ITEMS, makePlayer } from '~/stories/fixtures'
import Deck from './Deck.vue'

// Deck takes a flattened `HeroData` view (a subset of PlayerState) plus a
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
      SAMPLE_ITEMS.killshot_coil,
      SAMPLE_ITEMS.bkb,
      SAMPLE_ITEMS.treads,
      SAMPLE_ITEMS.rust_driver,
      SAMPLE_ITEMS.blink,
      SAMPLE_ITEMS.forceStaff,
    ],
    // A realistic mix: a survival buff (green), a movement steroid (green), an
    // enemy debuff on us (red), and an item-cooldown marker that the HUD hides.
    buffs: [
      { id: 'airgap', stacks: 1, ticksRemaining: 4, source: 'item', destination: 'p1' },
      { id: 'haste', stacks: 1, ticksRemaining: 3, source: 'cache', destination: 'p1' },
      { id: 'veil_discord', stacks: 25, ticksRemaining: 4, source: 'enemy', destination: 'p1' },
      {
        id: 'item_cd_hardshell',
        stacks: 1,
        ticksRemaining: 25,
        source: 'item',
        destination: 'p1',
      },
    ],
  }),
)

// Buff-strip presentation rules (~/utils/buffs displayBuffs):
//  - bookkeeping ids (stealthIdle, inCombat, …) NEVER render;
//  - stacks show only for true ramping counters (Heap Growth x24) — for the
//    rest, `stacks` encodes a magnitude and is hidden (Treads' 12 attack);
//  - permanent/refreshing markers (gait_rig_*, Resonance) show no
//    countdown; genuinely timed effects (Stunned 2t, Trauma Patch 4t) do.
const buffShowcase = heroFrom(
  makePlayer({
    name: 'buff_bearer',
    items: [SAMPLE_ITEMS.treads, null, null, null, null, null],
    buffs: [
      // Real effects — these render:
      { id: 'heapGrowth', stacks: 24, ticksRemaining: 999, source: 'ability', destination: 'p1' },
      { id: 'resonance', stacks: 5, ticksRemaining: 999, source: 'ability', destination: 'p1' },
      {
        id: 'gait_rig_attack',
        stacks: 12,
        ticksRemaining: 999,
        source: 'item',
        destination: 'p1',
      },
      { id: 'stun', stacks: 1, ticksRemaining: 2, source: 'enemy', destination: 'p1' },
      {
        id: 'trauma_patch_regen',
        stacks: 40,
        ticksRemaining: 4,
        source: 'item',
        destination: 'p1',
      },
      // Engine bookkeeping — the strip must NOT show these:
      { id: 'stealthIdle', stacks: 1, ticksRemaining: 3, source: 'ability', destination: 'p1' },
      { id: 'inCombat', stacks: 1, ticksRemaining: 2, source: 'system', destination: 'p1' },
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
  <Story title="Game/Deck">
    <Variant title="mid-game">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <Deck :hero="midGame" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="all abilities ready">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <Deck :hero="allReady" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="full build + buffs">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <Deck :hero="fullBuild" :hero-id="SAMPLE_HEROES.daemon" />
      </div>
    </Variant>

    <Variant title="buffs (bookkeeping hidden)">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <Deck :hero="buffShowcase" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="low hp / danger">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <Deck :hero="lowHp" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="dead">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <Deck :hero="dead" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>

    <Variant title="fresh spawn (empty)">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <Deck :hero="noBuild" :hero-id="SAMPLE_HERO_ID" />
      </div>
    </Variant>
  </Story>
</template>
