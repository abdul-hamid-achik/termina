<script setup lang="ts">
import type { CombatLine } from '~/utils/combatLog'
import { SAMPLE_HEROES } from '~/stories/fixtures'
import Stream from './Stream.vue'

// Stream renders a salience-tagged stream grouped into per-cycle "beats" with
// filter chips + a story/verbose toggle. STORY is the default view: every
// farm-tagged line (`farmKind`) of a tick folds into ONE dim `farm` summary
// line, and each cycle's lines re-order by salience — incoming-to-me first, then
// my actions, kills/objectives loud, ally beats, the world's business, and the
// farm digest last (see ~/utils/combatLog buildTickStoryView). The ─/≡ button
// in the header flips to the raw verbose stream — that's internal component
// state, so click it live in the preview to compare.
const stream: CombatLine[] = [
  { cycle: 236, text: '— DAY BREAKS · full vision —', type: 'objective' },
  {
    cycle: 237,
    text: 'you cast Stack Overflow on regex_mid',
    type: 'ability',
    salience: 'mine-out',
  },
  { cycle: 237, text: 'you hit regex_mid for 180 kinetic', type: 'damage', salience: 'mine-out' },
  { cycle: 237, text: 'regex_mid hit you for 95 code', type: 'damage', salience: 'mine-in' },
  { cycle: 238, text: 'kernel_main restored 120 to you', type: 'healing', salience: 'ally' },
  {
    cycle: 238,
    text: 'you terminated regex_mid  assist: kernel_main',
    type: 'kill',
    salience: 'mine-out',
    killerHeroId: SAMPLE_HEROES.echo,
    victimHeroId: SAMPLE_HEROES.regex,
  },
  { cycle: 238, text: 'you earned 240sc (hero kill)', type: 'scrip', salience: 'mine-out' },
  {
    cycle: 239,
    text: 'a wave hit the Audit ice for 60',
    type: 'damage',
    salience: 'world',
    dedupKey: 'dmg:t',
    dmgAmount: 60,
    count: 5,
  },
  {
    cycle: 239,
    text: 'CHAFF razed the AUDIT ice in coldstore-t1-audit',
    type: 'kill',
    salience: 'mine-out',
  },
  { cycle: 240, text: 'you reached level 10', type: 'system', salience: 'mine-out' },
  { cycle: 240, text: 'CHAFF slew Tenant (+900sc)', type: 'objective' },
]

// Story mode's farm digest: the ally/world farm-tagged lines below fold into
// one dim "farm: …" line per cycle (mine/team/enemy attributed), while the kill
// and my own trade stay loud. Tick 260 digests to "farm: team 1 wave, 1 camp ·
// enemy farming in sight"; tick 261 to "farm: team 2 waves · enemy 1 wave,
// 1 burn". Toggle ≡ to see the raw per-event stream these fold from.
const farmDigest: CombatLine[] = [
  {
    cycle: 260,
    text: 'you hit daemon_carry for 140 kinetic',
    type: 'damage',
    salience: 'mine-out',
  },
  { cycle: 260, text: 'daemon_carry hit you for 90 kinetic', type: 'damage', salience: 'mine-in' },
  {
    cycle: 260,
    text: 'kernel_main last-hit a line wave',
    type: 'scrip',
    salience: 'ally',
    farmKind: 'lasthit',
  },
  {
    cycle: 260,
    text: 'proxy_jg cleared a stub camp',
    type: 'scrip',
    salience: 'ally',
    farmKind: 'camp',
  },
  {
    cycle: 260,
    text: 'regex_mid hit a sweep wave for 48',
    type: 'damage',
    salience: 'world',
    farmKind: 'hit',
  },
  {
    cycle: 261,
    text: 'kernel_main terminated daemon_carry',
    type: 'kill',
    salience: 'ally',
    killerHeroId: SAMPLE_HEROES.kernel,
    victimHeroId: SAMPLE_HEROES.daemon,
  },
  {
    cycle: 261,
    text: 'cipher_off last-hit a breach wave',
    type: 'scrip',
    salience: 'ally',
    farmKind: 'lasthit',
  },
  {
    cycle: 261,
    text: 'cipher_off last-hit a line wave',
    type: 'scrip',
    salience: 'ally',
    farmKind: 'lasthit',
  },
  {
    cycle: 261,
    text: 'regex_mid last-hit a line wave',
    type: 'scrip',
    salience: 'world',
    farmKind: 'lasthit',
  },
  {
    cycle: 261,
    text: 'cache_sup burned a sweep wave',
    type: 'system',
    salience: 'world',
    farmKind: 'burn',
  },
]

// My own farming folds too — but a digest carrying MY rewards keeps mine-out
// salience (so the ME filter keeps it) and leads with my scrip: tick 270 digests
// to "farm: you +81sc (2 last-hits) · team 1 wave", tick 271 to "farm: you
// cleared a camp · you burned a wave · enemy farming in sight".
const myRewards: CombatLine[] = [
  {
    cycle: 270,
    text: 'you last-hit a line wave (+38sc)',
    type: 'scrip',
    salience: 'mine-out',
    farmKind: 'lasthit',
    scripAmount: 38,
  },
  {
    cycle: 270,
    text: 'you last-hit a sweep wave (+43sc)',
    type: 'scrip',
    salience: 'mine-out',
    farmKind: 'lasthit',
    scripAmount: 43,
  },
  {
    cycle: 270,
    text: 'kernel_main last-hit a line wave',
    type: 'scrip',
    salience: 'ally',
    farmKind: 'lasthit',
  },
  {
    cycle: 271,
    text: 'you cleared a stub camp',
    type: 'scrip',
    salience: 'mine-out',
    farmKind: 'camp',
  },
  {
    cycle: 271,
    text: 'you burned a line wave',
    type: 'system',
    salience: 'mine-out',
    farmKind: 'burn',
  },
  {
    cycle: 271,
    text: 'daemon_carry hit a wave for 55',
    type: 'damage',
    salience: 'world',
    farmKind: 'hit',
  },
]

// The shop/pickup confirmation lines (item_purchased / item_sold / cache_picked /
// neutral_killed) — text matched to combatNarrative so this is a faithful
// preview of what those events render as in the log.
const economy: CombatLine[] = [
  { cycle: 245, text: 'you acquired Blink Module (-2,250sc)', type: 'scrip', salience: 'mine-out' },
  { cycle: 246, text: 'you sold Scrap Lot (+25sc)', type: 'scrip', salience: 'mine-out' },
  { cycle: 247, text: 'you grabbed the haste cache', type: 'objective', salience: 'mine-out' },
  { cycle: 248, text: 'you cleared a stub camp', type: 'scrip', salience: 'mine-out' },
  { cycle: 248, text: 'daemon_carry sold Null Pointer (+700sc)', type: 'scrip', salience: 'world' },
]

// Kill lines carry a SHUTDOWN / spree suffix from combatNarrative.killFlair —
// text matched exactly so this previews how the streak callouts read in the log.
const sprees: CombatLine[] = [
  {
    cycle: 250,
    text: 'you terminated cache_sup  >> KILLING SPREE (3)',
    type: 'kill',
    salience: 'mine-out',
    killerHeroId: SAMPLE_HEROES.echo,
    victimHeroId: SAMPLE_HEROES.cache,
  },
  {
    cycle: 252,
    text: 'you terminated regex_mid  >> MEGA KILL (5)',
    type: 'kill',
    salience: 'mine-out',
    killerHeroId: SAMPLE_HEROES.echo,
    victimHeroId: SAMPLE_HEROES.regex,
  },
  {
    cycle: 255,
    text: 'daemon_carry terminated you  >> SHUTDOWN! (ended a 5-kill streak)',
    type: 'kill',
    salience: 'mine-in',
    killerHeroId: SAMPLE_HEROES.daemon,
    victimHeroId: SAMPLE_HEROES.echo,
  },
]
</script>

<template>
  <Story title="Game/Stream">
    <Variant title="active fight (multi-tick beats)">
      <div class="bg-bg-panel" style="width: 460px; height: 360px">
        <Stream :events="stream" />
      </div>
    </Variant>

    <Variant title="story mode: farm digest">
      <div class="bg-bg-panel" style="width: 460px; height: 300px">
        <Stream :events="farmDigest" />
      </div>
    </Variant>

    <Variant title="story mode: my rewards in the digest">
      <div class="bg-bg-panel" style="width: 460px; height: 300px">
        <Stream :events="myRewards" />
      </div>
    </Variant>

    <Variant title="economy & pickups (buy / sell / cache / camp)">
      <div class="bg-bg-panel" style="width: 460px; height: 240px">
        <Stream :events="economy" />
      </div>
    </Variant>

    <Variant title="sprees & shutdowns (kill-line flair)">
      <div class="bg-bg-panel" style="width: 460px; height: 240px">
        <Stream :events="sprees" />
      </div>
    </Variant>

    <Variant title="empty (awaiting events)">
      <div class="bg-bg-panel" style="width: 460px; height: 160px">
        <Stream :events="[]" />
      </div>
    </Variant>
  </Story>
</template>
