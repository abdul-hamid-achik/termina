<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AnnouncementToast from './AnnouncementToast.vue'

type Level = 'info' | 'warning' | 'kill' | 'objective' | 'error'
const seq = ref(0)
const text = ref('')
const level = ref<Level>('warning')

function show(msg: string, lvl: Level) {
  text.value = msg
  level.value = lvl
  seq.value++
}

// Auto-show one on mount so the default workbench view (and the build screenshot)
// renders the toast rather than an empty stage.
onMounted(() => show('Target is not in your zone', 'warning'))
</script>

<template>
  <Story title="Game/AnnouncementToast">
    <Variant title="interactive (all severities)">
      <div class="relative bg-bg-primary" style="height: 240px; width: 480px">
        <!-- Long duration so it persists for the screenshot; the buttons retrigger. -->
        <AnnouncementToast :text="text" :seq="seq" :level="level" :duration-ms="600000" />
        <div
          class="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-wrap justify-center gap-2"
        >
          <button
            class="t-mono rounded border border-warn px-2 py-1 text-xs text-warn"
            @click="show('Target is not in your zone', 'warning')"
          >
            warning
          </button>
          <button
            class="t-mono rounded border border-self px-2 py-1 text-xs text-self"
            @click="show('Reconnected to game', 'info')"
          >
            info
          </button>
          <button
            class="t-mono rounded border border-gold px-2 py-1 text-xs text-gold"
            @click="show('Roshan has been slain!', 'objective')"
          >
            objective
          </button>
          <button
            class="t-mono rounded border border-dire px-2 py-1 text-xs text-dire"
            @click="show('[ERROR] Connection lost. Reconnecting…', 'error')"
          >
            error
          </button>
        </div>
      </div>
    </Variant>
  </Story>
</template>
