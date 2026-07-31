<script setup lang="ts">
import ProgressBar from './ProgressBar.vue'
</script>

<!--
  Pure props-driven ASCII bar. Covers the team-color theme tokens (chaff/audit/
  ability/gold), the fill spectrum (empty → full + clamped over/under-flow), the
  optional value/percentage label, and custom widths.
-->
<template>
  <Story title="UI/ProgressBar" :layout="{ type: 'grid', width: 320 }">
    <Variant title="default (75%)">
      <ProgressBar :value="75" />
    </Variant>
    <Variant title="empty (0%)">
      <ProgressBar :value="0" />
    </Variant>
    <Variant title="full (100%)">
      <ProgressBar :value="100" />
    </Variant>
    <Variant title="with label">
      <ProgressBar :value="520" :max="620" show-label />
    </Variant>

    <Variant title="hp — chaff">
      <ProgressBar :value="520" :max="620" color="chaff" show-label />
    </Variant>
    <Variant title="hp — audit (low)">
      <ProgressBar :value="90" :max="980" color="audit" show-label />
    </Variant>
    <Variant title="hp — danger threshold (reddens + pulses below 25%)">
      <ProgressBar :value="110" :max="620" color="chaff" :danger-below="0.25" show-label />
    </Variant>
    <Variant title="hp — healthy (danger arm, above threshold)">
      <ProgressBar :value="500" :max="620" color="chaff" :danger-below="0.25" show-label />
    </Variant>
    <Variant title="BW — ability">
      <ProgressBar :value="180" :max="300" color="ability" show-label />
    </Variant>
    <Variant title="scrip">
      <ProgressBar :value="1400" :max="2000" color="scrip" show-label />
    </Variant>

    <Variant title="zone token">
      <ProgressBar :value="60" color="zone" show-label />
    </Variant>
    <Variant title="narrow width (8)">
      <ProgressBar :value="40" :width="8" show-label />
    </Variant>
    <Variant title="wide width (40)">
      <ProgressBar :value="40" :width="40" show-label />
    </Variant>

    <Variant title="clamp — overflow (>max)">
      <ProgressBar :value="900" :max="620" color="chaff" show-label />
    </Variant>
    <Variant title="clamp — underflow (<0)">
      <ProgressBar :value="-50" :max="620" color="audit" show-label />
    </Variant>

    <Variant title="playground">
      <ProgressBar :value="50" :max="100" color="chaff" :width="20" :show-label="true" />
    </Variant>
  </Story>
</template>
