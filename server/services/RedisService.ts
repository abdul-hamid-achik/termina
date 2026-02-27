import { Context, Effect, Layer } from 'effect'
import Redis from 'ioredis'

export interface RedisServiceApi {
  readonly get: (key: string) => Effect.Effect<string | null>
  readonly set: (key: string, value: string, ttl?: number) => Effect.Effect<void>
  readonly del: (key: string) => Effect.Effect<void>
  readonly lpush: (key: string, value: string) => Effect.Effect<void>
  readonly rpop: (key: string) => Effect.Effect<string | null>
  readonly llen: (key: string) => Effect.Effect<number>
  readonly publish: (channel: string, message: string) => Effect.Effect<void>
  readonly subscribe: (channel: string, handler: (message: string) => void) => Effect.Effect<void>
  readonly zadd: (key: string, score: number, member: string) => Effect.Effect<void>
  readonly zrangebyscore: (key: string, min: number, max: number) => Effect.Effect<string[]>
  readonly zrem: (key: string, member: string) => Effect.Effect<void>
  readonly zcard: (key: string) => Effect.Effect<number>
  readonly shutdown: () => Effect.Effect<void>
}

export class RedisService extends Context.Tag('RedisService')<RedisService, RedisServiceApi>() {}

export function makeRedisServiceLive(redisUrl: string) {
  return Layer.succeed(RedisService, {
    get: (key) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.get(key)
      }),

    set: (key, value, ttl) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        if (ttl) {
          await client.set(key, value, 'EX', ttl)
        } else {
          await client.set(key, value)
        }
      }),

    del: (key) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.del(key)
      }),

    lpush: (key, value) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.lpush(key, value)
      }),

    rpop: (key) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.rpop(key)
      }),

    llen: (key) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.llen(key)
      }),

    publish: (channel, message) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.publish(channel, message)
      }),

    subscribe: (channel, handler) =>
      Effect.sync(() => {
        const sub = getSubscriber(redisUrl)
        sub.subscribe(channel)
        sub.on('message', (ch, msg) => {
          if (ch === channel) handler(msg)
        })
      }),

    zadd: (key, score, member) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.zadd(key, score, member)
      }),

    zrangebyscore: (key, min, max) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.zrangebyscore(key, min, max)
      }),

    zrem: (key, member) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.zrem(key, member)
      }),

    zcard: (key) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.zcard(key)
      }),

    shutdown: () =>
      Effect.promise(async () => {
        if (_client) await _client.quit()
        if (_subscriber) await _subscriber.quit()
        _client = null
        _subscriber = null
      }),
  })
}

// ── Singleton connections ─────────────────────────────────────────

let _client: Redis | null = null
let _subscriber: Redis | null = null

function getClient(url: string): Redis {
  if (!_client) {
    _client = new Redis(url)
  }
  return _client
}

function getSubscriber(url: string): Redis {
  if (!_subscriber) {
    _subscriber = new Redis(url)
  }
  return _subscriber
}
