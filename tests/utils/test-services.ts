import { Effect, Layer } from 'effect'
import type { WebSocketService } from '~~/server/services/WebSocketService'
import { RedisService, type RedisServiceApi } from '~~/server/services/RedisService'
import type { DatabaseService } from '~~/server/services/DatabaseService'

/**
 * Mock implementations of services for integration testing
 */

export interface TestServices {
  wsService: WebSocketService
  redisService: RedisServiceApi
  dbService: DatabaseService
}

const mockRedisApi: RedisServiceApi = {
  get: () => Effect.succeed(null),
  set: () => Effect.succeed(void 0),
  del: () => Effect.succeed(void 0),
  lpush: () => Effect.succeed(void 0),
  rpush: () => Effect.succeed(void 0),
  rpop: () => Effect.succeed(null),
  llen: () => Effect.succeed(0),
  lrange: () => Effect.succeed([]),
  ltrim: () => Effect.succeed(void 0),
  publish: () => Effect.succeed(void 0),
  subscribe: () => Effect.succeed(void 0),
  unsubscribe: () => Effect.succeed(void 0),
  zadd: () => Effect.succeed(void 0),
  zrangebyscore: () => Effect.succeed([]),
  zrem: () => Effect.succeed(void 0),
  zcard: () => Effect.succeed(0),
  setnx: () => Effect.succeed(0),
  getdel: () => Effect.succeed(null),
  keys: () => Effect.succeed([]),
  expire: () => Effect.succeed(void 0),
  eval: () => Effect.succeed(null),
  shutdown: () => Effect.succeed(void 0),
}

export const MockRedisServiceLayer = Layer.succeed(RedisService, mockRedisApi)

export function createMockRedisService(): RedisServiceApi {
  return mockRedisApi
}

/**
 * Create mock services for testing
 * These services use in-memory stores instead of real connections
 */
export function createTestServices(): TestServices {
  // Mock WebSocket Service
  const wsService = {
    addConnection: (_gameId: string, _playerId: string, _ws: WebSocket) => Effect.succeed(void 0),
    removeConnection: (_playerId: string) => Effect.succeed(void 0),
    getConnections: (_gameId: string) => Effect.succeed(new Map<string, WebSocket>()),
    sendToPlayer: (_playerId: string, _message: unknown) => Effect.succeed(void 0),
    broadcastToGame: (_gameId: string, _message: unknown) => Effect.succeed(void 0),
  } as unknown as WebSocketService

  // Mock Redis Service
  const _redisService = {
    publish: (_channel: string, _message: string) => Effect.succeed(void 0),
    subscribe: (_channel: string) => Effect.succeed(void 0),
    get: (_key: string) => Effect.succeed<string | null>(null),
    set: (_key: string, _value: string) => Effect.succeed(void 0),
    del: (_key: string) => Effect.succeed(void 0),
    zadd: (_key: string, _score: number, _member: string) => Effect.succeed(void 0),
    zrem: (_key: string, _member: string) => Effect.succeed(void 0),
    zrange: (_key: string, _start: number, _stop: number) => Effect.succeed<string[]>([]),
    zcard: (_key: string) => Effect.succeed<number>(0),
  } as unknown as RedisService

  // Mock Database Service
  const dbService = {
    query: <T>(_sql: string, _params: unknown[]) => Effect.succeed<T[]>([]),
    insert: <T>(_table: string, _data: Record<string, unknown>) => Effect.succeed<T>({} as T),
    update: <T>(_table: string, _data: Record<string, unknown>, _where: Record<string, unknown>) =>
      Effect.succeed<T>({} as T),
    delete: (_table: string, _where: Record<string, unknown>) => Effect.succeed(void 0),
  } as unknown as DatabaseService

  return { wsService, redisService: mockRedisApi, dbService }
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
