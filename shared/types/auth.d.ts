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
    redis: { url: string }
    database: { url: string }
    resend: { apiKey: string; from: string; redirectTo: string }
    appUrl: string
  }
}

export {}
