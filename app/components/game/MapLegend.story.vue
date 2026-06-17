<script setup lang="ts">
import MapLegend from './MapLegend.vue'
</script>

<!--
  The collapsible glyph key shown under the map header. Collapsed by default so it
  doesn't clutter; expands to decode the terse map symbols for new players.
-->
<template>
  <Story title="Game/MapLegend">
    <Variant title="collapsed (default)">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <MapLegend />
      </div>
    </Variant>
    <Variant title="expanded (the full key)">
      <div class="bg-bg-primary p-3" style="width: 320px">
        <MapLegend :open="true" />
      </div>
    </Variant>
  </Story>
</template>
