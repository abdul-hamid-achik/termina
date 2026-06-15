<script setup lang="ts">
import { SAMPLE_NET_WORTH_HISTORY } from '~/stories/fixtures'
import Sparkline from './Sparkline.vue'

// A trend that climbs then dips, to show the line tracing both directions.
const wobble = [3200, 3100, 3400, 3300, 3900, 4300, 4100, 4600, 5100, 4950, 5400]
const flat = [4000, 4000, 4000, 4000, 4000]
</script>

<template>
  <Story title="Game/Sparkline" :layout="{ type: 'grid', width: 240 }">
    <Variant title="radiant net worth (gold)">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="SAMPLE_NET_WORTH_HISTORY.radiant" />
      </div>
    </Variant>
    <Variant title="dire net worth (dire color)">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="SAMPLE_NET_WORTH_HISTORY.dire" color-var="color-dire" />
      </div>
    </Variant>
    <Variant title="rise & dip (ability color)">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="wobble" color-var="color-ability" />
      </div>
    </Variant>
    <Variant title="flat trend">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="flat" color-var="color-radiant" />
      </div>
    </Variant>
    <Variant title="single sample">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="[4200]" />
      </div>
    </Variant>
  </Story>
</template>
