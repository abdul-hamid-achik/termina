<script setup lang="ts">
import PartyPanel from './PartyPanel.vue'

// PartyPanel fetches its party on mount ($fetch is stubbed empty in
// histoire.setup.ts), so stories render the initial "create / join" state — the
// main interaction surface. The in-party state (code + roster + start co-op) is
// driven by live API data in the app.
</script>

<template>
  <Story title="Lobby/PartyPanel">
    <Variant title="create or join">
      <div class="flex justify-center bg-bg-primary p-4">
        <div class="w-[340px]">
          <PartyPanel my-player-id="you" />
        </div>
      </div>
    </Variant>
  </Story>
</template>
