<script setup lang="ts">
import { computed } from 'vue'
import { formatRoshan, formatRunes, formatAegis } from '~/utils/strategy'
import type { RoshanState, RuneState } from '~~/shared/types/game'

const props = defineProps<{
  roshan: RoshanState | null
  runes: RuneState[]
  aegis: { zone: string; tick: number; holderId: string | null } | null
  tick: number
  /** The aegis carrier (resolved from the 'aegis' buff by the parent), if any. */
  aegisHolder?: { name: string; ticksRemaining: number } | null
}>()

const rosh = computed(() => formatRoshan(props.roshan, props.tick))
const rune = computed(() => formatRunes(props.runes, props.tick))
const aeg = computed(() => formatAegis(props.aegis, props.aegisHolder))
</script>

<template>
  <div data-testid="objective-ticker" class="flex flex-col gap-1 font-mono text-[0.72rem]">
    <!-- Roshan -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-text-dim">ROSHAN</span>
      <span
        :class="
          rosh.status === 'up'
            ? 'text-gold text-glow-gold font-bold'
            : rosh.status === 'dead'
              ? 'text-text-primary'
              : 'text-text-dim'
        "
      >
        <template v-if="rosh.status === 'up'">UP{{ rosh.hpPct != null ? ` ${rosh.hpPct}%` : '' }}</template>
        <template v-else-if="rosh.status === 'dead'">dead · {{ rosh.respawnIn }}t</template>
        <template v-else>?</template>
      </span>
    </div>
    <!-- Rune -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-text-dim">RUNE</span>
      <span :class="rune.live.length ? 'text-ability text-glow-ability font-bold' : 'text-text-dim'">
        <template v-if="rune.live.length">{{ rune.live[0]!.type }} · {{ rune.live[0]!.expiresIn }}t</template>
        <template v-else>next {{ rune.nextIn }}t</template>
      </span>
    </div>
    <!-- Aegis -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-text-dim">AEGIS</span>
      <span :class="aeg.held || aeg.inPit ? 'text-gold text-glow-gold font-bold' : 'text-text-dim'">
        <template v-if="aeg.held">{{ aeg.holderName }} · {{ aeg.expiresIn }}t</template>
        <template v-else-if="aeg.inPit">in pit</template>
        <template v-else>—</template>
      </span>
    </div>
  </div>
</template>
