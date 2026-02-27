<script setup lang="ts">
const navLinks = [
  { label: 'PLAY', to: '/play' },
  { label: 'LEARN', to: '/learn' },
  { label: 'LEADERBOARD', to: '/leaderboard' },
  { label: 'PROFILE', to: '/profile/me' },
]
</script>

<template>
  <div class="layout-default scanline-overlay">
    <header class="nav-bar">
      <NuxtLink to="/" class="nav-logo">
        <pre class="nav-logo__art">╔╦╗╔═╗╦═╗╔╦╗╦╔╗╔╔═╗
 ║ ║╣ ╠╦╝║║║║║║║╠═╣
 ╩ ╚═╝╩╚═╩ ╩╩╝╚╝╩ ╩</pre>
      </NuxtLink>
      <nav class="nav-links">
        <NuxtLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="nav-link"
        >
          [{{ link.label }}]
        </NuxtLink>
      </nav>
    </header>

    <main class="layout-main">
      <slot />
    </main>

    <footer class="nav-footer">
      <span class="nav-footer__text">TERMINA v0.1.0-alpha</span>
      <span class="nav-footer__sep">|</span>
      <span class="nav-footer__text">&gt;_ where every command is a kill</span>
    </footer>
  </div>
</template>

<style scoped>
.layout-default {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.nav-logo {
  text-decoration: none;
  color: var(--color-radiant);
}

.nav-logo__art {
  font-size: 0.55rem;
  line-height: 1.2;
  margin: 0;
}

.nav-links {
  display: flex;
  gap: 8px;
}

.nav-link {
  color: var(--text-dim);
  font-size: 0.8rem;
  padding: 4px 4px;
  transition: color 0.15s;
  text-decoration: none;
}

.nav-link:hover,
.nav-link.router-link-active {
  color: var(--color-ability);
}

.layout-main {
  flex: 1;
  padding: 16px;
}

.nav-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.nav-footer__text {
  color: var(--text-dim);
  font-size: 0.7rem;
}

.nav-footer__sep {
  color: var(--border-color);
  font-size: 0.7rem;
}

@media (max-width: 640px) {
  .nav-bar {
    flex-direction: column;
    gap: 8px;
  }

  .nav-logo__art {
    font-size: 0.45rem;
  }

  .nav-links {
    flex-wrap: wrap;
    justify-content: center;
  }
}
</style>
