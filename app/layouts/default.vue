<script setup lang="ts">
const { loggedIn, clear: clearSession } = useUserSession()

const publicNavLinks = [
  { label: 'PLAY', to: '/lobby' },
  { label: 'LEARN', to: '/learn' },
  { label: 'LEADERBOARD', to: '/leaderboard' },
]

const authNavLinks = [
  { label: 'PROFILE', to: '/profile/me' },
  { label: 'SETTINGS', to: '/profile/settings' },
]

const navLinks = computed(() =>
  loggedIn.value ? [...publicNavLinks, ...authNavLinks] : publicNavLinks,
)

async function logout() {
  await clearSession()
  navigateTo('/login')
}
</script>

<template>
  <div class="flex min-h-screen flex-col scanline-overlay">
    <header
      class="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-2 max-sm:flex-col max-sm:gap-2"
    >
      <NuxtLink to="/" class="text-radiant no-underline">
        <pre class="m-0 text-[0.55rem] leading-tight max-sm:text-[0.45rem]">
╔╦╗╔═╗╦═╗╔╦╗╦╔╗╔╔═╗
 ║ ║╣ ╠╦╝║║║║║║║╠═╣
 ╩ ╚═╝╩╚═╩ ╩╩╝╚╝╩ ╩</pre
        >
      </NuxtLink>
      <nav class="flex items-center gap-2 max-sm:flex-wrap max-sm:justify-center">
        <NuxtLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="px-1 py-1 text-[0.8rem] text-text-dim no-underline transition-colors duration-150 hover:text-ability [&.router-link-active]:text-ability"
        >
          [{{ link.label }}]
        </NuxtLink>
        <ClientOnly>
          <button
            v-if="loggedIn"
            class="cursor-pointer border-none bg-transparent px-1 py-1 text-[0.8rem] text-text-dim transition-colors duration-150 hover:text-dire"
            @click="logout"
          >
            [LOGOUT]
          </button>
          <NuxtLink
            v-else
            to="/login"
            class="px-1 py-1 text-[0.8rem] text-text-dim no-underline transition-colors duration-150 hover:text-radiant"
          >
            [LOGIN]
          </NuxtLink>
        </ClientOnly>
      </nav>
    </header>

    <main class="flex flex-1 flex-col p-4">
      <slot />
    </main>

    <footer
      class="flex items-center justify-center gap-2 border-t border-border bg-bg-secondary px-4 py-2"
    >
      <span class="text-[0.7rem] text-text-dim">TERMINA v0.1.0-alpha</span>
      <span class="text-[0.7rem] text-border">|</span>
      <span class="text-[0.7rem] text-text-dim">&gt;_ where every command is a kill</span>
    </footer>
  </div>
</template>
