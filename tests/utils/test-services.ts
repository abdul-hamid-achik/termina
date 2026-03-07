import { Effect, Layer } from 'effect'
import type { WebSocketService } from '~~/server/services/WebSocketService'
import type { RedisService } from '~~/server/services/RedisService'
import type { DatabaseService } from '~~/server/services/DatabaseService'

/**
 * Mock implementations of services for integration testing
 */

export interface TestServices {
  wsService: WebSocketService
  redisService: RedisService
  dbService: DatabaseService
}

/**
 * Create mock services for testing
 * These services use in-memory stores instead of real connections
 */
export function createTestServices(): TestServices {
  // Mock WebSocket Service
  const wsService = {
    addConnection: (gameId: string, playerId: string, ws: WebSocket) => Effect.succeed(void 0),
    removeConnection: (playerId: string) => Effect.succeed(void 0),
    getConnections: (gameId: string) => Effect.succeed(new Map<string, WebSocket>()),
    sendToPlayer: (playerId: string, message: unknown) => Effect.succeed(void 0),
    broadcastToGame: (gameId: string, message: unknown) => Effect.succeed(void 0),
  } as unknown as WebSocketService

  // Mock Redis Service
  const redisService = {
    publish: (channel: string, message: string) => Effect.succeed(void 0),
    subscribe: (channel: string) => Effect.succeed(void 0),
    get: (key: string) => Effect.succeed<string | null>(null),
    set: (key: string, value: string) => Effect.succeed(void 0),
    del: (key: string) => Effect.succeed(void 0),
    zadd: (key: string, score: number, member: string) => Effect.succeed(void 0),
    zrem: (key: string, member: string) => Effect.succeed(void 0),
    zrange: (key: string, start: number, stop: number) => Effect.succeed<string[]>([]),
    zcard: (key: string) => Effect.succeed<number>(0),
  } as unknown as RedisService

  // Mock Database Service
  const dbService = {
    query: <T>(sql: string, params: unknown[]) => Effect.succeed<T[]>([]),
    insert: <T>(table: string, data: Record<string, unknown>) => Effect.succeed<T>({} as T),
    update: <T>(table: string, data: Record<string, unknown>, where: Record<string, unknown>) =>
      Effect.succeed<T>({} as T),
    delete: (table: string, where: Record<string, unknown>) => Effect.succeed(void 0),
  } as unknown as DatabaseService

  return { wsService, redisService, dbService }
}

/**
 * Create a mock WebSocket for testing
 */
export function createMockWebSocket(): WebSocket & { sentMessages: string[] } {
  const mockWs = {
    sentMessages: [] as string[],
    send: function (data: string | ArrayBuffer | Uint8Array) {
      if (typeof data === 'string') {
        this.sentMessages.push(data)
      }
      return undefined
    },
    close: function () {
      // Mock close
    },
    // Add other required WebSocket properties
    readyState: 1,
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  } as WebSocket & { sentMessages: string[] }

  return mockWs
}
