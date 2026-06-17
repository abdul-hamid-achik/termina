<script setup lang="ts">
import DamageFloat from './DamageFloat.vue'
</script>

<template>
  <Story title="Game/DamageFloat">
    <Variant title="taken + dealt">
      <div class="relative bg-bg-primary" style="height: 240px; width: 320px">
        <DamageFloat
          :floats="[
            { id: 1, amount: 120, kind: 'taken' },
            { id: 2, amount: 80, kind: 'dealt' },
            { id: 3, amount: 45, kind: 'dealt' },
          ]"
        />
      </div>
    </Variant>
    <Variant title="with heals (teal +N)">
      <div class="relative bg-bg-primary" style="height: 240px; width: 320px">
        <DamageFloat
          :floats="[
            { id: 1, amount: 110, kind: 'taken' },
            { id: 2, amount: 50, kind: 'heal' },
            { id: 3, amount: 200, kind: 'heal' },
          ]"
        />
      </div>
    </Variant>
    <Variant title="empty">
      <div class="relative bg-bg-primary" style="height: 120px; width: 320px">
        <DamageFloat :floats="[]" />
      </div>
    </Variant>
  </Story>
</template>
