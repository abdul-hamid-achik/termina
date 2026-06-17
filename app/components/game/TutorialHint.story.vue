<script setup lang="ts">
import TutorialHint from './TutorialHint.vue'

// TutorialHint is pure props (just `step`), so each Variant is a different point
// in the staggered-unlock flow: move → attack → cast → buy → complete.
</script>

<template>
  <Story title="Game/TutorialHint">
    <Variant title="step 1 — learn to move">
      <div class="bg-bg-primary" style="width: 640px"><TutorialHint :step="0" /></div>
    </Variant>
    <Variant title="step 2 — last-hit (attack)">
      <div class="bg-bg-primary" style="width: 640px"><TutorialHint :step="1" /></div>
    </Variant>
    <Variant title="step 3 — use an ability (cast)">
      <div class="bg-bg-primary" style="width: 640px"><TutorialHint :step="2" /></div>
    </Variant>
    <Variant title="step 4 — buy an item">
      <div class="bg-bg-primary" style="width: 640px"><TutorialHint :step="3" /></div>
    </Variant>
    <Variant title="complete — free play">
      <div class="bg-bg-primary" style="width: 640px"><TutorialHint :step="4" /></div>
    </Variant>
  </Story>
</template>
