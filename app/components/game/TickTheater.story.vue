<script setup lang="ts">
import type { CombatLine } from '~/utils/combatLog'
import TickTheater from './TickTheater.vue'

const events: CombatLine[] = [
  { tick: 41, text: 'echo last-hit a melee creep (+38g)', type: 'gold' },
  { tick: 41, text: 'daemon cast Null Pointer on echo (120 magic)', type: 'damage' },
  { tick: 42, text: 'echo denied a ranged creep', type: 'system' },
  { tick: 42, text: 'kernel healed echo (+90)', type: 'healing' },
  { tick: 43, text: 'echo killed daemon!', type: 'kill' },
]
</script>

<template>
  <Story title="Game/TickTheater">
    <Variant title="awaiting orders">
      <div class="bg-bg-primary" style="width: 460px; height: 260px">
        <TickTheater
          :events="events"
          status="AWAITING ORDERS"
          bar="██████░░░░░░"
          :tick-imminent="false"
          :next-tick-in="2400"
          :is-alive="true"
          :can-act="true"
          :pulse-key="0"
        />
      </div>
    </Variant>

    <Variant title="tick imminent">
      <div class="bg-bg-primary" style="width: 460px; height: 260px">
        <TickTheater
          :events="events"
          status="AWAITING ORDERS"
          bar="█░░░░░░░░░░░"
          :tick-imminent="true"
          :next-tick-in="600"
          :is-alive="true"
          :can-act="true"
          :pulse-key="1"
        />
      </div>
    </Variant>

    <Variant title="down (dead)">
      <div class="bg-bg-primary" style="width: 460px; height: 260px">
        <TickTheater
          :events="events"
          status="DOWN"
          bar="████████████"
          :tick-imminent="false"
          :next-tick-in="3000"
          :is-alive="false"
          :can-act="false"
          :pulse-key="0"
        />
      </div>
    </Variant>
  </Story>
</template>
