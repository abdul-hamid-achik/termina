<script setup lang="ts">
import TargetDummy from './TargetDummy.vue'
</script>

<template>
  <Story title="Heroes/TargetDummy" :layout="{ type: 'grid', width: 320 }">
    <Variant title="Full HP">
      <TargetDummy name="Target Dummy" :hp="1000" :max-hp="1000" />
    </Variant>
    <Variant title="Half (gold)">
      <TargetDummy name="Target Dummy" :hp="480" :max-hp="1000" />
    </Variant>
    <Variant title="Low (dire) + DoT">
      <TargetDummy name="Target Dummy" :hp="180" :max-hp="1000" :dots="2" />
    </Variant>
    <Variant title="Under control (stun + slow)">
      <TargetDummy
        name="Target Dummy"
        :hp="620"
        :max-hp="1000"
        :statuses="[
          { label: 'STUNNED', ticksLeft: 2 },
          { label: 'SLOW 30%', ticksLeft: 3 },
        ]"
      />
    </Variant>
    <Variant title="Destroyed">
      <TargetDummy name="Target Dummy" :hp="0" :max-hp="1000" />
    </Variant>
  </Story>
</template>
