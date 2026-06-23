<script setup lang="ts">
import MapPrimer from './MapPrimer.vue'
</script>

<template>
  <Story title="Game/MapPrimer" :layout="{ type: 'single', iframe: false }">
    <Variant title="Explore the map">
      <div class="bg-bg-primary p-2" style="max-width: 760px">
        <MapPrimer />
      </div>
    </Variant>
  </Story>
</template>
