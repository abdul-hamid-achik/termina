<script setup lang="ts">
import ProgressBar from './ProgressBar.vue'
</script>

<!--
  Pure props-driven ASCII bar. Covers the team-color theme tokens (radiant/dire/
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

    <Variant title="hp — radiant">
      <ProgressBar :value="520" :max="620" color="radiant" show-label />
    </Variant>
    <Variant title="hp — dire (low)">
      <ProgressBar :value="90" :max="980" color="dire" show-label />
    </Variant>
    <Variant title="mana — ability">
      <ProgressBar :value="180" :max="300" color="ability" show-label />
    </Variant>
    <Variant title="gold">
      <ProgressBar :value="1400" :max="2000" color="gold" show-label />
    </Variant>

    <Variant title="hex color">
      <ProgressBar :value="60" color="#7CFC00" show-label />
    </Variant>
    <Variant title="narrow width (8)">
      <ProgressBar :value="40" :width="8" show-label />
    </Variant>
    <Variant title="wide width (40)">
      <ProgressBar :value="40" :width="40" show-label />
    </Variant>

    <Variant title="clamp — overflow (>max)">
      <ProgressBar :value="900" :max="620" color="radiant" show-label />
    </Variant>
    <Variant title="clamp — underflow (<0)">
      <ProgressBar :value="-50" :max="620" color="dire" show-label />
    </Variant>

    <Variant title="playground">
      <ProgressBar :value="50" :max="100" color="radiant" :width="20" :show-label="true" />
    </Variant>
  </Story>
</template>
