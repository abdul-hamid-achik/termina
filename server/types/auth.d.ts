declare module '#auth-utils' {
  interface User {
    id: string
    username: string
    avatarUrl: string | null
    selectedAvatar: string | null
    provider: 'github' | 'discord' | 'local'
    hasPassword: boolean
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
  }
}

export {}
