<script setup lang="ts">
import type { KillFeedEntry } from '~/utils/combatNarrative'
import { SAMPLE_HEROES } from '~/stories/fixtures'
import KillFeed from './KillFeed.vue'

// KillFeed is the loud cinematic banner. It takes pre-derived KillFeedEntry rows
// (category drives the color), the current cycle, and a window/max. The inline
// hero avatars resolve from killer/victim heroId.
const CURRENT = 240

function entry(overrides: Partial<KillFeedEntry> = {}): KillFeedEntry {
  return {
    cycle: CURRENT,
    category: 'hero',
    killerId: 'p1',
    victimId: 'e2',
    killerHeroId: SAMPLE_HEROES.echo,
    victimHeroId: SAMPLE_HEROES.regex,
    assisters: [],
    text: "you SIGKILL'd regex_mid",
    ...overrides,
  }
}

const firstBlood = [entry({ firstBlood: true, text: "FIRST BLOOD  you SIGKILL'd regex_mid" })]

const multiKill = [
  entry({
    multiKill: 3,
    streak: 5,
    text: "TRIPLE KILL  you SIGKILL'd cache_sup",
    victimHeroId: SAMPLE_HEROES.cache,
  }),
]

// A stacked cluster: a hero kill, a ice fall, and a Tenant slay together.
const cluster = [
  entry({
    cycle: CURRENT - 1,
    shutdown: true,
    text: "SHUTDOWN  you SIGKILL'd daemon_carry",
    victimHeroId: SAMPLE_HEROES.daemon,
  }),
  entry({
    cycle: CURRENT,
    category: 'ice',
    killerHeroId: undefined,
    victimHeroId: undefined,
    text: 'CHAFF razed a AUDIT ice',
  }),
  entry({
    cycle: CURRENT,
    category: 'tenant',
    killerHeroId: undefined,
    victimHeroId: undefined,
    text: 'CHAFF slew TENANT',
  }),
]

const coreDown = [
  entry({
    category: 'core',
    killerHeroId: undefined,
    victimHeroId: undefined,
    text: 'CHAFF CORE DUMPED the AUDIT Terminal',
  }),
]
</script>

<template>
  <Story title="Game/KillFeed" :layout="{ type: 'grid', width: 460 }">
    <Variant title="first blood">
      <div class="bg-bg-primary p-4" style="width: 440px">
        <KillFeed :entries="firstBlood" :current-cycle="CURRENT" />
      </div>
    </Variant>

    <Variant title="triple kill (streak)">
      <div class="bg-bg-primary p-4" style="width: 440px">
        <KillFeed :entries="multiKill" :current-cycle="CURRENT" />
      </div>
    </Variant>

    <Variant title="cluster (hero · ice · tenant)">
      <div class="bg-bg-primary p-4" style="width: 440px">
        <KillFeed :entries="cluster" :current-cycle="CURRENT" :max="3" />
      </div>
    </Variant>

    <Variant title="core dumped">
      <div class="bg-bg-primary p-4" style="width: 440px">
        <KillFeed :entries="coreDown" :current-cycle="CURRENT" />
      </div>
    </Variant>

    <Variant title="empty (aged out)">
      <div class="bg-bg-primary p-4 text-text-dim text-xs" style="width: 440px">
        <KillFeed :entries="firstBlood" :current-cycle="CURRENT + 10" />
        <span>&gt;_ banners aged out — nothing rendered</span>
      </div>
    </Variant>
  </Story>
</template>
