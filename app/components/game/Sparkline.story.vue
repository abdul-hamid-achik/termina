<script setup lang="ts">
import { SAMPLE_NET_WORTH_HISTORY } from '~/stories/fixtures'
import Sparkline from './Sparkline.vue'

// A trend that climbs then dips, to show the line tracing both directions.
const wobble = [3200, 3100, 3400, 3300, 3900, 4300, 4100, 4600, 5100, 4950, 5400]
const flat = [4000, 4000, 4000, 4000, 4000]
</script>

<template>
  <Story title="Game/Sparkline" :layout="{ type: 'grid', width: 240 }">
    <Variant title="chaff net worth (gold)">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="SAMPLE_NET_WORTH_HISTORY.chaff" />
      </div>
    </Variant>
    <Variant title="audit net worth (audit color)">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="SAMPLE_NET_WORTH_HISTORY.audit" color-var="color-audit" />
      </div>
    </Variant>
    <Variant title="rise & dip (ability color)">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="wobble" color-var="color-ability" />
      </div>
    </Variant>
    <Variant title="flat trend">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="flat" color-var="color-chaff" />
      </div>
    </Variant>
    <Variant title="single sample">
      <div class="bg-bg-primary p-2 text-lg">
        <Sparkline :values="[4200]" />
      </div>
    </Variant>
  </Story>
</template>
