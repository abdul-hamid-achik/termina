<script setup lang="ts">
import type { CreepState, NeutralCreepState } from '~~/shared/types/game'
import { SAMPLE_HEROES, makePlayer, makeTower } from '~/stories/fixtures'
import ZonePanel from './ZonePanel.vue'

/** A visible creep plus its index in the client's creeps array. */
type IndexedCreep = CreepState & { index: number }

function creep(overrides: Partial<IndexedCreep> = {}): IndexedCreep {
  return {
    id: 'creep_0',
    team: 'dire',
    zone: 'mid-river',
    hp: 300,
    type: 'melee',
    index: 0,
    ...overrides,
  }
}

function neutral(overrides: Partial<NeutralCreepState> = {}): NeutralCreepState {
  return {
    id: 'n0',
    zone: 'jungle-rad-top',
    hp: 250,
    maxHp: 250,
    type: 'kobold',
    alive: true,
    ...overrides,
  }
}

// ── Variant data ───────────────────────────────────────────────

// Solo in a river zone, nothing around (CLEAR + a river objective).
const cleared = {
  zoneName: 'Mid River',
  zoneId: 'mid-river',
}

// Even fight: one enemy hero vs. you alone => CONTESTED.
const contested = {
  enemies: [
    makePlayer({
      id: 'e1',
      name: 'daemon_carry',
      team: 'dire',
      heroId: SAMPLE_HEROES.daemon,
      hp: 540,
      maxHp: 700,
    }),
  ],
  allies: [],
}

// Outnumbered: two enemy heroes, no allies => DANGER.
const danger = {
  enemies: [
    makePlayer({
      id: 'e1',
      name: 'daemon_carry',
      team: 'dire',
      heroId: SAMPLE_HEROES.daemon,
      hp: 540,
      maxHp: 700,
    }),
    makePlayer({
      id: 'e2',
      name: 'regex_mid',
      team: 'dire',
      heroId: SAMPLE_HEROES.regex,
      hp: 410,
      maxHp: 600,
      mp: 80,
      maxMp: 320,
    }),
  ],
  allies: [
    makePlayer({
      id: 'p2',
      name: 'kernel_main',
      heroId: SAMPLE_HEROES.kernel,
      hp: 320,
      maxHp: 980,
    }),
  ],
}

// Pushing a lane with creep support + an enemy tower to siege.
const laneSiege = {
  zoneName: 'Mid T1 (Dire)',
  zoneId: 'mid-t1-dire',
  tower: makeTower('dire', 'mid-t1-dire', { hp: 720, maxHp: 1800 }),
  creeps: [
    creep({ id: 'rc1', team: 'radiant', hp: 240, index: 0 }),
    creep({ id: 'rc2', team: 'radiant', hp: 300, type: 'ranged', index: 1 }),
    creep({ id: 'dc1', team: 'dire', hp: 120, index: 2 }),
    creep({ id: 'dc2', team: 'dire', hp: 55, type: 'siege', index: 3 }),
  ] as IndexedCreep[],
}

// A deny window: an allied creep has dropped below 50% HP, so it can be
// denied (the allied-creep group becomes a tappable [deny] action).
const denyWindow = {
  zoneName: 'Mid Lane (Radiant)',
  zoneId: 'mid-t1-rad',
  creeps: [
    creep({ id: 'rc1', team: 'radiant', hp: 140, index: 0 }), // melee, denyable (<200)
    creep({ id: 'rc2', team: 'radiant', hp: 300, type: 'ranged', index: 1 }),
    creep({ id: 'dc1', team: 'dire', hp: 110, index: 2 }),
  ] as IndexedCreep[],
}

// A neutral jungle camp.
const jungle = {
  zoneName: 'Radiant Jungle (Top)',
  zoneId: 'jungle-rad-top',
  neutrals: [
    neutral({ id: 'n1', hp: 250 }),
    neutral({ id: 'n2', hp: 90, type: 'ogre_mage' }),
    neutral({ id: 'n3', hp: 0, alive: false }),
  ] as NeutralCreepState[],
}
</script>

<template>
  <Story title="Game/ZonePanel">
    <Variant title="clear (empty)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="cleared" player-team="radiant" />
      </div>
    </Variant>

    <Variant title="contested (even)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel
          zone-name="Mid River"
          zone-id="mid-river"
          player-team="radiant"
          :enemies="contested.enemies"
          :allies="contested.allies"
        />
      </div>
    </Variant>

    <Variant title="danger (outnumbered)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel
          zone-name="Mid River"
          zone-id="mid-river"
          player-team="radiant"
          :enemies="danger.enemies"
          :allies="danger.allies"
        />
      </div>
    </Variant>

    <Variant title="lane siege (tower + creeps)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="laneSiege" player-team="radiant" />
      </div>
    </Variant>

    <Variant title="deny window (allied creep <50%)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="denyWindow" player-team="radiant" />
      </div>
    </Variant>

    <Variant title="jungle neutrals">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="jungle" player-team="radiant" />
      </div>
    </Variant>
  </Story>
</template>
