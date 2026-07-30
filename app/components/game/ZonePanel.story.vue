<script setup lang="ts">
import type { WaveUnitState, NeutralUnitState } from '~~/shared/types/game'
import { SAMPLE_HEROES, makePlayer, makeIce } from '~/stories/fixtures'
import ZonePanel from './ZonePanel.vue'

/** A visible wave plus its index in the client's waves array. */
type IndexedWave = WaveUnitState & { index: number }

function wave(overrides: Partial<IndexedWave> = {}): IndexedWave {
  return {
    id: 'creep_0',
    team: 'audit',
    zone: 'mid-river',
    hp: 300,
    type: 'line',
    index: 0,
    ...overrides,
  }
}

/** A neutral plus its index in the GLOBAL neutrals array. */
type IndexedNeutral = NeutralUnitState & { index: number }

function neutral(overrides: Partial<IndexedNeutral> = {}): IndexedNeutral {
  return {
    id: 'n0',
    zone: 'silt-chaff-top',
    hp: 250,
    maxHp: 250,
    type: 'kobold',
    alive: true,
    index: 0,
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
      team: 'audit',
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
      team: 'audit',
      heroId: SAMPLE_HEROES.daemon,
      hp: 540,
      maxHp: 700,
    }),
    makePlayer({
      id: 'e2',
      name: 'regex_mid',
      team: 'audit',
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

// Pushing a lane with wave support + an enemy ice to breach.
const laneBreach = {
  zoneName: 'Mid T1 (Audit)',
  zoneId: 'mid-t1-audit',
  ice: makeIce('audit', 'mid-t1-audit', { hp: 720, maxHp: 1800 }),
  waves: [
    wave({ id: 'rc1', team: 'chaff', hp: 240, index: 0 }),
    wave({ id: 'rc2', team: 'chaff', hp: 300, type: 'sweep', index: 1 }),
    wave({ id: 'dc1', team: 'audit', hp: 120, index: 2 }),
    wave({ id: 'dc2', team: 'audit', hp: 55, type: 'breach', index: 3 }),
  ] as IndexedWave[],
}

// A burn window: an allied wave has dropped below 50% HP, so it can be
// burned (the allied-wave group becomes a tappable [burn] action).
const burnWindow = {
  zoneName: 'Mid Lane (Chaff)',
  zoneId: 'mid-t1-chaff',
  waves: [
    wave({ id: 'rc1', team: 'chaff', hp: 140, index: 0 }), // line, denyable (<200)
    wave({ id: 'rc2', team: 'chaff', hp: 300, type: 'sweep', index: 1 }),
    wave({ id: 'dc1', team: 'audit', hp: 110, index: 2 }),
  ] as IndexedWave[],
}

// A neutral jungle camp.
const jungle = {
  zoneName: 'Chaff Jungle (Top)',
  zoneId: 'silt-chaff-top',
  neutrals: [
    neutral({ id: 'n1', hp: 250, index: 3 }),
    neutral({ id: 'n2', hp: 90, type: 'ogre_mage', index: 4 }),
    neutral({ id: 'n3', hp: 0, alive: false, index: 5 }),
  ] as IndexedNeutral[],
}

// The Tenant pit with him up — the one place the attack affordance appears.
const tenantPit = {
  zoneName: 'The Hollow',
  zoneId: 'hollow',
  tenant: { alive: true, hp: 3200, maxHp: 5000, deathTick: null },
}
</script>

<template>
  <Story title="Game/ZonePanel">
    <Variant title="clear (empty)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="cleared" player-team="chaff" />
      </div>
    </Variant>

    <Variant title="contested (even)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel
          zone-name="Mid River"
          zone-id="mid-river"
          player-team="chaff"
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
          player-team="chaff"
          :enemies="danger.enemies"
          :allies="danger.allies"
        />
      </div>
    </Variant>

    <Variant title="lane breach (ice + waves)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="laneBreach" player-team="chaff" />
      </div>
    </Variant>

    <Variant title="burn window (allied wave <50%)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="burnWindow" player-team="chaff" />
      </div>
    </Variant>

    <Variant title="jungle neutrals">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="jungle" player-team="chaff" />
      </div>
    </Variant>

    <Variant title="tenant pit (alive)">
      <div class="bg-bg-primary p-2" style="width: 300px">
        <ZonePanel v-bind="tenantPit" player-team="chaff" />
      </div>
    </Variant>
  </Story>
</template>
