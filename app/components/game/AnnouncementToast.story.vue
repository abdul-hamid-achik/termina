<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AnnouncementToast from './AnnouncementToast.vue'

const seq = ref(0)
const text = ref('')

function show(msg: string) {
  text.value = msg
  seq.value++
}

// Auto-show one on mount so the default workbench view (and the build screenshot)
// renders the toast rather than an empty stage.
onMounted(() => show('Target is not in your zone'))
</script>

<template>
  <Story title="Game/AnnouncementToast">
    <Variant title="interactive">
      <div class="relative bg-bg-primary" style="height: 220px; width: 460px">
        <!-- Long duration so it persists for the screenshot; the buttons retrigger. -->
        <AnnouncementToast :text="text" :seq="seq" :duration-ms="600000" />
        <div class="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
          <button
            class="t-mono rounded border border-warn px-2 py-1 text-xs text-warn"
            @click="show('Target is not in your zone')"
          >
            warning
          </button>
          <button
            class="t-mono rounded border border-warn px-2 py-1 text-xs text-warn"
            @click="show('The enemy Mainframe is firewalled — destroy a T3 tower first')"
          >
            firewall
          </button>
          <button
            class="t-mono rounded border border-dire px-2 py-1 text-xs text-dire"
            @click="show('[ERROR] Connection lost. Reconnecting…')"
          >
            error
          </button>
        </div>
      </div>
    </Variant>
  </Story>
</template>
