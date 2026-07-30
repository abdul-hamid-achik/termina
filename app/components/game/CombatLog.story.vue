<script setup lang="ts">
import type { CombatLine } from '~/utils/combatLog'
import { SAMPLE_HEROES } from '~/stories/fixtures'
import CombatLog from './CombatLog.vue'

// CombatLog renders a salience-tagged stream grouped into per-tick "beats" with
// filter chips + a story/verbose toggle. STORY is the default view: every
// farm-tagged line (`farmKind`) of a tick folds into ONE dim `farm` summary
// line, and each tick's lines re-order by salience — incoming-to-me first, then
// my actions, kills/objectives loud, ally beats, the world's business, and the
// farm digest last (see ~/utils/combatLog buildTickStoryView). The ─/≡ button
// in the header flips to the raw verbose stream — that's internal component
// state, so click it live in the preview to compare.
const stream: CombatLine[] = [
  { tick: 236, text: '— DAY BREAKS · full vision —', type: 'objective' },
  {
    tick: 237,
    text: 'you cast Stack Overflow on regex_mid',
    type: 'ability',
    salience: 'mine-out',
  },
  { tick: 237, text: 'you hit regex_mid for 180 physical', type: 'damage', salience: 'mine-out' },
  { tick: 237, text: 'regex_mid hit you for 95 magical', type: 'damage', salience: 'mine-in' },
  { tick: 238, text: 'kernel_main restored 120 to you', type: 'healing', salience: 'ally' },
  {
    tick: 238,
    text: 'you terminated regex_mid  assist: kernel_main',
    type: 'kill',
    salience: 'mine-out',
    killerHeroId: SAMPLE_HEROES.echo,
    victimHeroId: SAMPLE_HEROES.regex,
  },
  { tick: 238, text: 'you earned 240g (hero kill)', type: 'gold', salience: 'mine-out' },
  {
    tick: 239,
    text: 'a creep hit the Audit ice for 60',
    type: 'damage',
    salience: 'world',
    dedupKey: 'dmg:t',
    dmgAmount: 60,
    count: 5,
  },
  {
    tick: 239,
    text: 'CHAFF razed the AUDIT ice in mid-t1-audit',
    type: 'kill',
    salience: 'mine-out',
  },
  { tick: 240, text: 'you reached level 10', type: 'system', salience: 'mine-out' },
  { tick: 240, text: 'CHAFF slew Tenant (+900g)', type: 'objective' },
]

// Story mode's farm digest: the ally/world farm-tagged lines below fold into
// one dim "farm: …" line per tick (mine/team/enemy attributed), while the kill
// and my own trade stay loud. Tick 260 digests to "farm: team 1 creep, 1 camp ·
// enemy farming in sight"; tick 261 to "farm: team 2 creeps · enemy 1 creep,
// 1 burn". Toggle ≡ to see the raw per-event stream these fold from.
const farmDigest: CombatLine[] = [
  {
    tick: 260,
    text: 'you hit daemon_carry for 140 physical',
    type: 'damage',
    salience: 'mine-out',
  },
  { tick: 260, text: 'daemon_carry hit you for 90 physical', type: 'damage', salience: 'mine-in' },
  {
    tick: 260,
    text: 'kernel_main last-hit a melee creep',
    type: 'gold',
    salience: 'ally',
    farmKind: 'lasthit',
  },
  {
    tick: 260,
    text: 'proxy_jg cleared a kobold camp',
    type: 'gold',
    salience: 'ally',
    farmKind: 'camp',
  },
  {
    tick: 260,
    text: 'regex_mid hit a ranged creep for 48',
    type: 'damage',
    salience: 'world',
    farmKind: 'hit',
  },
  {
    tick: 261,
    text: 'kernel_main terminated daemon_carry',
    type: 'kill',
    salience: 'ally',
    killerHeroId: SAMPLE_HEROES.kernel,
    victimHeroId: SAMPLE_HEROES.daemon,
  },
  {
    tick: 261,
    text: 'cipher_off last-hit a siege creep',
    type: 'gold',
    salience: 'ally',
    farmKind: 'lasthit',
  },
  {
    tick: 261,
    text: 'cipher_off last-hit a melee creep',
    type: 'gold',
    salience: 'ally',
    farmKind: 'lasthit',
  },
  {
    tick: 261,
    text: 'regex_mid last-hit a melee creep',
    type: 'gold',
    salience: 'world',
    farmKind: 'lasthit',
  },
  {
    tick: 261,
    text: 'cache_sup burned a ranged creep',
    type: 'system',
    salience: 'world',
    farmKind: 'burn',
  },
]

// My own farming folds too — but a digest carrying MY rewards keeps mine-out
// salience (so the ME filter keeps it) and leads with my gold: tick 270 digests
// to "farm: you +81g (2 last-hits) · team 1 creep", tick 271 to "farm: you
// cleared a camp · you burned a creep · enemy farming in sight".
const myRewards: CombatLine[] = [
  {
    tick: 270,
    text: 'you last-hit a melee creep (+38g)',
    type: 'gold',
    salience: 'mine-out',
    farmKind: 'lasthit',
    goldAmount: 38,
  },
  {
    tick: 270,
    text: 'you last-hit a ranged creep (+43g)',
    type: 'gold',
    salience: 'mine-out',
    farmKind: 'lasthit',
    goldAmount: 43,
  },
  {
    tick: 270,
    text: 'kernel_main last-hit a melee creep',
    type: 'gold',
    salience: 'ally',
    farmKind: 'lasthit',
  },
  {
    tick: 271,
    text: 'you cleared a kobold camp',
    type: 'gold',
    salience: 'mine-out',
    farmKind: 'camp',
  },
  {
    tick: 271,
    text: 'you burned a melee creep',
    type: 'system',
    salience: 'mine-out',
    farmKind: 'burn',
  },
  {
    tick: 271,
    text: 'daemon_carry hit a creep for 55',
    type: 'damage',
    salience: 'world',
    farmKind: 'hit',
  },
]

// The shop/pickup confirmation lines (item_purchased / item_sold / cache_picked /
// neutral_killed) — text matched to combatNarrative so this is a faithful
// preview of what those events render as in the log.
const economy: CombatLine[] = [
  { tick: 245, text: 'you acquired Blink Module (-2,250g)', type: 'gold', salience: 'mine-out' },
  { tick: 246, text: 'you sold Iron Branch (+25g)', type: 'gold', salience: 'mine-out' },
  { tick: 247, text: 'you grabbed the haste cache', type: 'objective', salience: 'mine-out' },
  { tick: 248, text: 'you cleared a kobold camp', type: 'gold', salience: 'mine-out' },
  { tick: 248, text: 'daemon_carry sold Null Pointer (+700g)', type: 'gold', salience: 'world' },
]

// Kill lines carry a SHUTDOWN / spree suffix from combatNarrative.killFlair —
// text matched exactly so this previews how the streak callouts read in the log.
const sprees: CombatLine[] = [
  {
    tick: 250,
    text: 'you terminated cache_sup  >> KILLING SPREE (3)',
    type: 'kill',
    salience: 'mine-out',
    killerHeroId: SAMPLE_HEROES.echo,
    victimHeroId: SAMPLE_HEROES.cache,
  },
  {
    tick: 252,
    text: 'you terminated regex_mid  >> MEGA KILL (5)',
    type: 'kill',
    salience: 'mine-out',
    killerHeroId: SAMPLE_HEROES.echo,
    victimHeroId: SAMPLE_HEROES.regex,
  },
  {
    tick: 255,
    text: 'daemon_carry terminated you  >> SHUTDOWN! (ended a 5-kill streak)',
    type: 'kill',
    salience: 'mine-in',
    killerHeroId: SAMPLE_HEROES.daemon,
    victimHeroId: SAMPLE_HEROES.echo,
  },
]
</script>

<template>
  <Story title="Game/CombatLog">
    <Variant title="active fight (multi-tick beats)">
      <div class="bg-bg-panel" style="width: 460px; height: 360px">
        <CombatLog :events="stream" />
      </div>
    </Variant>

    <Variant title="story mode: farm digest">
      <div class="bg-bg-panel" style="width: 460px; height: 300px">
        <CombatLog :events="farmDigest" />
      </div>
    </Variant>

    <Variant title="story mode: my rewards in the digest">
      <div class="bg-bg-panel" style="width: 460px; height: 300px">
        <CombatLog :events="myRewards" />
      </div>
    </Variant>

    <Variant title="economy & pickups (buy / sell / cache / camp)">
      <div class="bg-bg-panel" style="width: 460px; height: 240px">
        <CombatLog :events="economy" />
      </div>
    </Variant>

    <Variant title="sprees & shutdowns (kill-line flair)">
      <div class="bg-bg-panel" style="width: 460px; height: 240px">
        <CombatLog :events="sprees" />
      </div>
    </Variant>

    <Variant title="empty (awaiting events)">
      <div class="bg-bg-panel" style="width: 460px; height: 160px">
        <CombatLog :events="[]" />
      </div>
    </Variant>
  </Story>
</template>
