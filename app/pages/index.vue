<template>
  <div class="landing">
    <div class="landing__hero">
      <pre class="landing__logo text-glow">
████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗
   ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝</pre>

      <p class="landing__tagline">&gt;_ where every command is a kill</p>
    </div>

    <div class="landing__features">
      <div class="feature">
        <span class="feature__marker">[01]</span>
        <span class="feature__text">Text-based MOBA — command your hero through a terminal interface</span>
      </div>
      <div class="feature">
        <span class="feature__marker">[02]</span>
        <span class="feature__text">Tick-based combat — plan, execute, outplay. Every 4 seconds matters.</span>
      </div>
      <div class="feature">
        <span class="feature__marker">[03]</span>
        <span class="feature__text">6 unique heroes — carries, supports, assassins, tanks, mages</span>
      </div>
      <div class="feature">
        <span class="feature__marker">[04]</span>
        <span class="feature__text">Fog of war — use wards and scan to reveal the unseen</span>
      </div>
    </div>

    <div class="landing__actions">
      <NuxtLink to="/play">
        <AsciiButton label="ENTER THE TERMINAL" variant="primary" />
      </NuxtLink>
      <NuxtLink to="/learn">
        <AsciiButton label="LEARN COMMANDS" variant="ghost" />
      </NuxtLink>
    </div>

    <div class="landing__prompt">
      <span class="prompt-char">&gt;</span>
      <span class="prompt-text">ready_</span>
      <span class="cursor-blink">█</span>
    </div>
  </div>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 120px);
  gap: 32px;
  padding: 32px 16px;
  text-align: center;
}

.landing__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.landing__logo {
  color: var(--color-radiant);
  font-size: 0.5rem;
  line-height: 1.15;
  margin: 0;
}

.landing__tagline {
  color: var(--text-dim);
  font-size: 1rem;
  letter-spacing: 0.05em;
}

.landing__features {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 600px;
  text-align: left;
}

.feature {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 0.85rem;
}

.feature__marker {
  color: var(--color-ability);
  flex-shrink: 0;
}

.feature__text {
  color: var(--text-dim);
}

.landing__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.landing__actions a {
  text-decoration: none;
}

.landing__prompt {
  margin-top: 16px;
  font-size: 0.85rem;
}

.prompt-char {
  color: var(--color-radiant);
  font-weight: 700;
}

.prompt-text {
  color: var(--text-dim);
  margin-left: 4px;
}

@media (min-width: 768px) {
  .landing__logo {
    font-size: 0.7rem;
  }
}
</style>
