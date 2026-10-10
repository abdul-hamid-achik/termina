declare module '#auth-utils' {
  interface User {
    id: string
    username: string
    avatarUrl: string | null
    selectedAvatar: string | null
    provider: 'github' | 'discord' | 'local'
    hasPassword: boolean
    /** True once the guided tutorial is done — drives the new-player funnel. */
    tutorialCompleted: boolean
    /**
     * True for an ephemeral guest session (see server/api/auth/guest.post.ts):
     * no `players` DB row backs this id, so anything that reads/writes one
     * must skip guests rather than 404/500. Absent (not merely false) for
     * every real account.
     */
    guest?: boolean
  }
  interface SecureSessionData {
    /**
     * Server-only. Set when a GUEST session was replaced by a real identity
     * (register / login / OAuth): the guest id, so that guest's still-running
     * practice game can refuse the old tab's orders with GAME_SESSION_CHANGED
     * instead of a bare 403 (server/utils/guest.ts).
     */
    formerGuestId?: string
  }
}

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    session: {
      password: string
      cookie: {
        secure: boolean
      }
    }
    oauth: {
      github: { clientId: string; clientSecret: string }
      discord: { clientId: string; clientSecret: string }
    }
    database: { url: string }
    resend: { apiKey: string; from: string; redirectTo: string }
    appUrl: string
  }
}

export {}
