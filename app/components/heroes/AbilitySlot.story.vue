<script setup lang="ts">
import AbilitySlot from './AbilitySlot.vue'
import { HEROES } from '~~/shared/constants/heroes'

const echo = HEROES.echo!
</script>

<template>
  <Story title="Heroes/AbilitySlot" :layout="{ type: 'grid', width: 320 }">
    <Variant title="ready (interactive)">
      <AbilitySlot slot-key="Q" :ability="echo.abilities.q" interactive />
    </Variant>
    <Variant title="on cooldown">
      <AbilitySlot slot-key="R" :ability="echo.abilities.r" :cooldown-remaining="3" interactive />
    </Variant>
    <Variant title="unaffordable">
      <AbilitySlot slot-key="W" :ability="echo.abilities.w" :mana-available="0" interactive />
    </Variant>
    <Variant title="passive (static)">
      <AbilitySlot slot-key="◆" :ability="echo.passive" />
    </Variant>
  </Story>
</template>
