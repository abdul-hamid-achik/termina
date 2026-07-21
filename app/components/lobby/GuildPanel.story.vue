<script setup lang="ts">
import GuildPanel from './GuildPanel.vue'

// GuildPanel fetches the player's guild + the guild list on mount ($fetch is
// stubbed empty in histoire.setup.ts), so stories render the initial
// "create / join" state. The in-guild state (tag + roster + leave) is driven by
// live API data in the app.
</script>

<template>
  <Story title="Lobby/GuildPanel">
    <Variant title="create or join">
      <div class="flex justify-center bg-bg-primary p-4">
        <div class="w-[340px]">
          <GuildPanel my-player-id="you" />
        </div>
      </div>
    </Variant>
  </Story>
</template>
