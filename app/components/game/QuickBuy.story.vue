<script setup lang="ts">
import { SAMPLE_ITEMS } from '~/stories/fixtures'
import { DEFAULT_QUICKBUY_ITEMS } from '~~/shared/constants/items'
import QuickBuy from './QuickBuy.vue'

// Real item ids — the component resolves names/costs from shared/constants/items.
const PINNED = [SAMPLE_ITEMS.bkb, SAMPLE_ITEMS.blink, SAMPLE_ITEMS.daedalus]
// What a brand-new player sees: the curated starter pins (no saved prefs yet).
const STARTER = [...DEFAULT_QUICKBUY_ITEMS]
</script>

<template>
  <Story title="Game/QuickBuy" :layout="{ type: 'grid', width: 360 }">
    <!-- New-player default pins at typical starting gold (DEFAULT_QUICKBUY_ITEMS). -->
    <Variant title="new-player starter pins">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <QuickBuy :pinned-items="STARTER" :gold="600" :can-buy="true" />
      </div>
    </Variant>

    <!-- Plenty of gold: every pin is affordable and buyable. -->
    <Variant title="all affordable">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <QuickBuy :pinned-items="PINNED" :gold="9000" :can-buy="true" />
      </div>
    </Variant>

    <!-- Some affordable, some short on gold (shows the -Ng deficit). -->
    <Variant title="mixed affordability">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <QuickBuy :pinned-items="PINNED" :gold="2200" :can-buy="true" />
      </div>
    </Variant>

    <!-- Can't act this tick: affordable items show, but no [BUY] action. -->
    <Variant title="cannot buy (waiting tick)">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <QuickBuy :pinned-items="PINNED" :gold="9000" :can-buy="false" />
      </div>
    </Variant>

    <!-- Broke: only deficits, nothing buyable. -->
    <Variant title="broke">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <QuickBuy :pinned-items="PINNED" :gold="120" :can-buy="true" />
      </div>
    </Variant>

    <!-- No pins → the component renders nothing (empty state). -->
    <Variant title="empty (renders nothing)">
      <div class="bg-bg-primary p-2 text-text-dim text-xs" style="width: 320px">
        <QuickBuy :pinned-items="[]" :gold="9000" :can-buy="true" />
        <span>&gt;_ no pinned items — component is empty</span>
      </div>
    </Variant>
  </Story>
</template>
