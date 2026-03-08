import { Context, Effect, Layer } from 'effect'
import Redis from 'ioredis'

export interface RedisServiceApi {
  readonly get: (key: string) => Effect.Effect<string | null>
  readonly set: (key: string, value: string, ttl?: number) => Effect.Effect<void>
  readonly del: (key: string) => Effect.Effect<void>
  readonly lpush: (key: string, value: string) => Effect.Effect<void>
  readonly rpush: (key: string, value: string) => Effect.Effect<void>
  readonly rpop: (key: string) => Effect.Effect<string | null>
  readonly llen: (key: string) => Effect.Effect<number>
  readonly lrange: (key: string, start: number, stop: number) => Effect.Effect<string[]>
  readonly ltrim: (key: string, start: number, stop: number) => Effect.Effect<void>
  readonly publish: (channel: string, message: string) => Effect.Effect<void>
  readonly subscribe: (channel: string, handler: (message: string) => void) => Effect.Effect<void>
  readonly unsubscribe: (channel: string, handler: (message: string) => void) => Effect.Effect<void>
  readonly zadd: (key: string, score: number, member: string) => Effect.Effect<void>
  readonly zrangebyscore: (key: string, min: number, max: number) => Effect.Effect<string[]>
  readonly zrem: (key: string, member: string) => Effect.Effect<void>
  readonly zcard: (key: string) => Effect.Effect<number>
  readonly setnx: (key: string, value: string, ttlSeconds?: number) => Effect.Effect<number>
  readonly getdel: (key: string) => Effect.Effect<string | null>
  readonly keys: (pattern: string) => Effect.Effect<string[]>
  readonly expire: (key: string, seconds: number) => Effect.Effect<void>
  readonly eval: (
    script: string,
    keys: string[],
    args: (string | number)[],
  ) => Effect.Effect<unknown>
  readonly shutdown: () => Effect.Effect<void>
}

export class RedisService extends Context.Tag('RedisService')<RedisService, RedisServiceApi>() {}

type SubscriptionEntry = {
  handlers: Set<(message: string) => void>
}

const subscriptions = new Map<string, SubscriptionEntry>()

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

    rpush: (key, value) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.rpush(key, value)
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

    lrange: (key, start, stop) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.lrange(key, start, stop)
      }),

    ltrim: (key, start, stop) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.ltrim(key, start, stop)
      }),

    publish: (channel, message) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.publish(channel, message)
      }).pipe(
        Effect.tap(() => Effect.logDebug('Redis published').pipe(Effect.annotateLogs({ channel }))),
      ),

    subscribe: (channel, handler) =>
      Effect.sync(() => {
        const sub = getSubscriber(redisUrl)

        let entry = subscriptions.get(channel)
        if (!entry) {
          entry = { handlers: new Set() }
          subscriptions.set(channel, entry)
          sub.subscribe(channel)
        }

        if (!entry.handlers.has(handler)) {
          entry.handlers.add(handler)
        }
      }).pipe(
        Effect.tap(() =>
          Effect.logDebug('Redis subscribed').pipe(Effect.annotateLogs({ channel })),
        ),
      ),

    unsubscribe: (channel, handler) =>
      Effect.sync(() => {
        const entry = subscriptions.get(channel)
        if (!entry) return

        entry.handlers.delete(handler)

        if (entry.handlers.size === 0) {
          subscriptions.delete(channel)
          const sub = _subscriber
          if (sub) {
            sub.unsubscribe(channel)
          }
        }
      }).pipe(
        Effect.tap(() =>
          Effect.logDebug('Redis unsubscribed').pipe(Effect.annotateLogs({ channel })),
        ),
      ),

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

    setnx: (key, value, ttlSeconds) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        if (ttlSeconds) {
          const result = await client.set(key, value, 'EX', ttlSeconds, 'NX')
          return result === 'OK' ? 1 : 0
        }
        return client.setnx(key, value)
      }),

    getdel: (key) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.getdel(key)
      }),

    keys: (pattern) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.keys(pattern)
      }),

    expire: (key, seconds) =>
      Effect.promise(async () => {
        const client = getClient(redisUrl)
        await client.expire(key, seconds)
      }),

    eval: (script, keys, args) =>
      Effect.promise(() => {
        const client = getClient(redisUrl)
        return client.eval(script, keys.length, ...keys, ...args)
      }),

    shutdown: () =>
      Effect.promise(async () => {
        if (_client) await _client.quit()
        if (_subscriber) await _subscriber.quit()
        _client = null
        _subscriber = null
        subscriptions.clear()
      }).pipe(Effect.tap(() => Effect.logInfo('Redis connection closed'))),
  })
}

let _client: Redis | null = null
let _subscriber: Redis | null = null

function getClient(url: string): Redis {
  if (!_client) {
    _client = new Redis(url)
  }
  return _client
}

function handleMessage(channel: string, message: string) {
  const entry = subscriptions.get(channel)
  if (entry) {
    for (const handler of entry.handlers) {
      try {
        handler(message)
      } catch (err) {
        Effect.runSync(
          Effect.logError(`Redis handler error for channel ${channel}`).pipe(
            Effect.annotateLogs({ error: String(err) }),
          ),
        )
      }
    }
  }
}

function resubscribeAll() {
  if (!_subscriber) return
  for (const [channel] of subscriptions) {
    _subscriber.subscribe(channel).catch((err) => {
      Effect.runSync(
        Effect.logError(`Failed to resubscribe to ${channel}`).pipe(
          Effect.annotateLogs({ error: String(err) }),
        ),
      )
    })
  }
}

function getSubscriber(url: string): Redis {
  if (!_subscriber) {
    _subscriber = new Redis(url)

    _subscriber.on('message', (channel: string, message: string) => {
      handleMessage(channel, message)
    })

    _subscriber.on('error', (err: Error) => {
      Effect.runSync(
        Effect.logError('Redis subscriber error').pipe(Effect.annotateLogs({ error: err.message })),
      )
    })

    _subscriber.on('close', () => {
      Effect.runSync(Effect.logInfo('Redis subscriber closed, attempting reconnect...'))
      setTimeout(() => {
        if (_subscriber) {
          resubscribeAll()
        }
      }, 1000)
    })
  }
  return _subscriber
}
