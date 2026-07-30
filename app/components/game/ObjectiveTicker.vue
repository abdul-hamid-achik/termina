<script setup lang="ts">
import { computed } from 'vue'
import { formatTenant, formatCaches, formatBackup, ticksToClock, shortZone } from '~/utils/strategy'
import { buffLabel } from '~/utils/buffs'
import type { TenantState, CacheState } from '~~/shared/types/game'

const props = defineProps<{
  tenant: TenantState | null
  caches: CacheState[]
  backup: { zone: string; tick: number; holderId: string | null } | null
  tick: number
  /** The backup carrier (resolved from the 'backup' buff by the parent), if any. */
  backupHolder?: { name: string; ticksRemaining: number } | null
}>()

const rosh = computed(() => formatTenant(props.tenant, props.tick))
const cache = computed(() => formatCaches(props.caches, props.tick))
const aeg = computed(() => formatBackup(props.backup, props.backupHolder))
</script>

<template>
  <div data-testid="objective-ticker" class="flex flex-col gap-1 font-mono text-[0.72rem]">
    <!-- Tenant -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-text-dim">TENANT</span>
      <span
        :class="
          rosh.status === 'up'
            ? 'text-gold text-glow-gold font-bold'
            : rosh.status === 'dead'
              ? 'text-text-primary'
              : 'text-text-dim'
        "
      >
        <template v-if="rosh.status === 'up'"
          >UP{{ rosh.hpPct != null ? ` ${rosh.hpPct}%` : '' }}</template
        >
        <!-- Whether you can contest the next Tenant is a wall-clock decision;
             "34t" only means something to someone who knows a tick is 4s. -->
        <template v-else-if="rosh.status === 'dead'"
          >dead · {{ ticksToClock(rosh.respawnIn) }}</template
        >
        <template v-else>?</template>
      </span>
    </div>
    <!-- Cache -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-text-dim">CACHE</span>
      <span
        :class="cache.live.length ? 'text-ability text-glow-ability font-bold' : 'text-text-dim'"
      >
        <!-- The zone is the whole decision: a cache you cannot reach before it
             expires is not an objective. formatCaches already carried it. -->
        <template v-if="cache.live.length"
          ><!-- buffLabel: 'dd' → 'Double Damage', 'invis' → 'Invisible' -->
          {{ buffLabel(cache.live[0]!.type) }} @ {{ shortZone(cache.live[0]!.zone) }} ·
          {{ cache.live[0]!.expiresIn }}c</template
        >
        <template v-else>next {{ cache.nextIn }}c</template>
      </span>
    </div>
    <!-- Backup -->
    <div class="flex items-center justify-between gap-2">
      <span class="text-text-dim">BACKUP</span>
      <span :class="aeg.held || aeg.inPit ? 'text-gold text-glow-gold font-bold' : 'text-text-dim'">
        <template v-if="aeg.held">{{ aeg.holderName }} · {{ aeg.expiresIn }}c</template>
        <template v-else-if="aeg.inPit">in pit</template>
        <template v-else>—</template>
      </span>
    </div>
  </div>
</template>
