<script setup lang="ts">
import TerminalText from './TerminalText.vue'
</script>

<!--
  Pure slot/props inline text. Covers the bold + dim modifiers and the `color`
  prop resolving against the theme tokens (radiant/dire/ability/gold/text-dim)
  as well as a raw hex fallback. Wrapped on the dark bg so colors are legible.
-->
<template>
  <Story title="UI/TerminalText" :layout="{ type: 'grid', width: 240 }">
    <Variant title="default">
      <div class="bg-bg-primary p-2">
        <TerminalText>plain mono text</TerminalText>
      </div>
    </Variant>
    <Variant title="bold">
      <div class="bg-bg-primary p-2">
        <TerminalText bold>bold text</TerminalText>
      </div>
    </Variant>
    <Variant title="dim">
      <div class="bg-bg-primary p-2">
        <TerminalText dim>dimmed text</TerminalText>
      </div>
    </Variant>
    <Variant title="bold + dim">
      <div class="bg-bg-primary p-2">
        <TerminalText bold dim>bold dimmed</TerminalText>
      </div>
    </Variant>

    <Variant title="color — radiant">
      <div class="bg-bg-primary p-2">
        <TerminalText color="radiant" bold>RADIANT</TerminalText>
      </div>
    </Variant>
    <Variant title="color — dire">
      <div class="bg-bg-primary p-2">
        <TerminalText color="dire" bold>DIRE</TerminalText>
      </div>
    </Variant>
    <Variant title="color — ability">
      <div class="bg-bg-primary p-2">
        <TerminalText color="ability">[Q] Pulse</TerminalText>
      </div>
    </Variant>
    <Variant title="color — gold">
      <div class="bg-bg-primary p-2">
        <TerminalText color="gold">1,400g</TerminalText>
      </div>
    </Variant>
    <Variant title="color — text-dim token">
      <div class="bg-bg-primary p-2">
        <TerminalText color="text-dim">muted via token</TerminalText>
      </div>
    </Variant>
    <Variant title="color — raw hex">
      <div class="bg-bg-primary p-2">
        <TerminalText color="#7CFC00">#7CFC00</TerminalText>
      </div>
    </Variant>

    <Variant title="inline composition">
      <div class="bg-bg-primary p-2">
        <TerminalText color="radiant" bold>echo</TerminalText>
        <TerminalText dim> slew </TerminalText>
        <TerminalText color="dire" bold>regex</TerminalText>
      </div>
    </Variant>
  </Story>
</template>
