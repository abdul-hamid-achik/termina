declare module '#auth-utils' {
  interface User {
    id: string
    username: string
    avatarUrl: string | null
    provider: 'github' | 'discord'
  }
}

export {}
