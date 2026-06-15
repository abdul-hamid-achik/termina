<script setup lang="ts">
import TalentPicker from './TalentPicker.vue'
import { makePlayer, SAMPLE_HEROES } from '~/stories/fixtures'

const tier10 = makePlayer({ heroId: SAMPLE_HEROES.echo, level: 10 })
const tier15 = makePlayer({
  heroId: SAMPLE_HEROES.echo,
  level: 16,
  talents: { tier10: 'echo_10_left', tier15: null, tier20: null, tier25: null },
})
const allChosen = makePlayer({
  heroId: SAMPLE_HEROES.echo,
  level: 25,
  talents: {
    tier10: 'echo_10_left',
    tier15: 'echo_15_right',
    tier20: 'echo_20_left',
    tier25: 'echo_25_right',
  },
})
const tooLow = makePlayer({ heroId: SAMPLE_HEROES.echo, level: 8 })
</script>

<template>
  <Story title="Game/TalentPicker">
    <Variant title="tier 10 unlocked">
      <div class="bg-bg-primary p-3" style="width: 420px">
        <TalentPicker :player="tier10" />
      </div>
    </Variant>
    <Variant title="tier 15 (tier 10 already chosen)">
      <div class="bg-bg-primary p-3" style="width: 420px">
        <TalentPicker :player="tier15" />
      </div>
    </Variant>
    <Variant title="below talent level — hidden">
      <div class="bg-bg-primary p-3" style="width: 420px">
        <TalentPicker :player="tooLow" />
        <p class="text-text-dim text-xs">(nothing renders until level 10)</p>
      </div>
    </Variant>
    <Variant title="all chosen — hidden">
      <div class="bg-bg-primary p-3" style="width: 420px">
        <TalentPicker :player="allChosen" />
        <p class="text-text-dim text-xs">(nothing renders once all tiers are picked)</p>
      </div>
    </Variant>
  </Story>
</template>
