<template>
  <div class="layout-game">
    <slot />
  </div>
</template>

<style scoped>
.layout-game {
  width: 100vw;
  height: 100vh;
  background: var(--bg-primary);
  overflow: hidden;
}
</style>
