<script setup lang="ts">
import TargetDummy from './TargetDummy.vue'
</script>

<template>
  <Story title="Heroes/TargetDummy" :layout="{ type: 'grid', width: 320 }">
    <Variant title="Full INTEG">
      <TargetDummy name="Target Dummy" :integ="1000" :max-integ="1000" />
    </Variant>
    <Variant title="Half (scrip)">
      <TargetDummy name="Target Dummy" :integ="480" :max-integ="1000" />
    </Variant>
    <Variant title="Low (audit) + DoT">
      <TargetDummy name="Target Dummy" :integ="180" :max-integ="1000" :dots="2" />
    </Variant>
    <Variant title="Under control (stun + slow)">
      <TargetDummy
        name="Target Dummy"
        :integ="620"
        :max-integ="1000"
        :statuses="[
          { label: 'STUNNED', ticksLeft: 2 },
          { label: 'SLOW 30%', ticksLeft: 3 },
        ]"
      />
    </Variant>
    <Variant title="Destroyed">
      <TargetDummy name="Target Dummy" :integ="0" :max-integ="1000" />
    </Variant>
  </Story>
</template>
