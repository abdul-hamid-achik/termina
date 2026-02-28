import type { APIRequestContext } from '@playwright/test'

export interface TestUser {
  username: string
  password: string
}

export function generateTestUser(): TestUser {
  // Username must be 3-20 chars, alphanumeric + underscore only
  const short = Math.random().toString(36).slice(2, 10)
  return {
    username: `t_${short}`,
    password: 'E2eTestPass123!',
  }
}

export async function registerAndLogin(
  request: APIRequestContext,
  user?: TestUser,
): Promise<{ user: TestUser; cookies: Awaited<ReturnType<APIRequestContext['storageState']>> }> {
  const testUser = user ?? generateTestUser()

  const response = await request.post('/api/auth/register', {
    data: {
      username: testUser.username,
      password: testUser.password,
    },
  })

  if (response.status() === 409) {
    // User already exists — try login instead
    const loginResponse = await request.post('/api/auth/login', {
      data: {
        username: testUser.username,
        password: testUser.password,
      },
    })
    if (!loginResponse.ok()) {
      throw new Error(
        `Login failed (${loginResponse.status()}): ${await loginResponse.text()}`,
      )
    }
  } else if (!response.ok()) {
    throw new Error(
      `Registration failed (${response.status()}): ${await response.text()}`,
    )
  }

  const cookies = await request.storageState()
  return { user: testUser, cookies }
}

