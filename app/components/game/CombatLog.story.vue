<script setup lang="ts">
import type { CombatLine } from '~/utils/combatLog'
import { SAMPLE_HEROES } from '~/stories/fixtures'
import CombatLog from './CombatLog.vue'

// CombatLog renders a salience-tagged stream grouped into per-tick "beats" with
// filter chips + a verbose/terse toggle. We feed a realistic multi-tick fight.
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
    text: 'a creep hit the Dire tower for 60',
    type: 'damage',
    salience: 'world',
    dedupKey: 'dmg:t',
    dmgAmount: 60,
    count: 5,
  },
  {
    tick: 239,
    text: 'RADIANT razed the DIRE tower in mid-t1-dire',
    type: 'kill',
    salience: 'mine-out',
  },
  { tick: 240, text: 'you reached level 10', type: 'system', salience: 'mine-out' },
  { tick: 240, text: 'RADIANT slew Roshan (+900g)', type: 'objective' },
]

const farming: CombatLine[] = [
  { tick: 240, text: 'you last-hit a melee creep (+38g)', type: 'gold', salience: 'mine-out' },
  { tick: 240, text: 'a creep hit a tower for 22', type: 'damage', salience: 'world' },
  { tick: 240, text: 'daemon_carry cleared a kobold camp', type: 'gold', salience: 'world' },
  { tick: 241, text: 'you denied a melee creep', type: 'system', salience: 'mine-out' },
]

// The shop/pickup confirmation lines (item_purchased / item_sold / rune_picked /
// neutral_killed) — text matched to combatNarrative so this is a faithful
// preview of what those events render as in the log.
const economy: CombatLine[] = [
  { tick: 245, text: 'you acquired Blink Module (-2,250g)', type: 'gold', salience: 'mine-out' },
  { tick: 246, text: 'you sold Iron Branch (+25g)', type: 'gold', salience: 'mine-out' },
  { tick: 247, text: 'you grabbed the haste rune', type: 'objective', salience: 'mine-out' },
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

    <Variant title="farming noise (try the terse toggle)">
      <div class="bg-bg-panel" style="width: 460px; height: 300px">
        <CombatLog :events="farming" />
      </div>
    </Variant>

    <Variant title="economy & pickups (buy / sell / rune / camp)">
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
