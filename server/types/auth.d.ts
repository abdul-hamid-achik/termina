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

export {}
