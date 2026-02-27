<template>
  <div class="login-page">
    <div class="login-box">
      <pre class="login-logo">╔╦╗╔═╗╦═╗╔╦╗╦╔╗╔╔═╗
 ║ ║╣ ╠╦╝║║║║║║║╠═╣
 ╩ ╚═╝╩╚═╩ ╩╩╝╚╝╩ ╩</pre>
      <p class="login-subtitle">&gt;_ authenticate to continue</p>

      <div class="login-actions">
        <AsciiButton label="LOGIN WITH GITHUB" variant="primary" />
        <AsciiButton label="LOGIN WITH DISCORD" variant="primary" />
      </div>

      <p class="login-footer">
        <span class="text-dim">No account?</span>
        Sign in to create one automatically.
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 120px);
  padding: 32px 16px;
}

.login-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 32px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  max-width: 400px;
  width: 100%;
}

.login-logo {
  color: var(--color-radiant);
  font-size: 0.6rem;
  line-height: 1.2;
  margin: 0;
  text-align: center;
}

.login-subtitle {
  color: var(--text-dim);
  font-size: 0.85rem;
}

.login-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  align-items: stretch;
}

.login-actions :deep(.ascii-btn) {
  width: 100%;
  justify-content: center;
}

.login-footer {
  font-size: 0.75rem;
  color: var(--text-dim);
}

.text-dim {
  color: var(--text-dim);
}
</style>
