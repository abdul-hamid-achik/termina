<script setup lang="ts">
import AsciiButton from './AsciiButton.vue'
</script>

<!--
  Smoke story (Histoire GO/NO-GO gate): a pure, Nuxt-agnostic leaf component
  across all variants + the disabled state. If this renders WITH terminal.css
  styling (mono font, themed border/glow colors), the Histoire ⨯ Vite 7 ⨯
  Tailwind 4 wiring is sound and the rest of the stories can follow.
-->
<template>
  <Story title="UI/AsciiButton" :layout="{ type: 'grid', width: 200 }">
    <Variant title="default">
      <AsciiButton label="Play" />
    </Variant>
    <Variant title="primary">
      <AsciiButton label="Queue" variant="primary" />
    </Variant>
    <Variant title="danger">
      <AsciiButton label="Surrender" variant="danger" />
    </Variant>
    <Variant title="ghost">
      <AsciiButton label="Cancel" variant="ghost" />
    </Variant>
    <Variant title="disabled">
      <AsciiButton label="Locked" disabled />
    </Variant>
  </Story>
</template>
