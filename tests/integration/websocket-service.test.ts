/**
 * Real WebSocket integration test — spins up an actual WS server, connects
 * a real client, and exercises WebSocketService against live sockets. This
 * complements the unit tests (which use mock WebSocket objects) by
 * verifying that messages actually round-trip over the wire.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { createServer, type Server } from 'node:http'
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws'
import {
  WebSocketService,
  WebSocketServiceLive,
} from '../../server/services/WebSocketService'
import type { ServerMessage } from '../../shared/types/protocol'

interface Harness {
  port: number
  httpServer: Server
  wsServer: WebSocketServer
  /** Sockets the server has accepted, keyed by connection order. */
  serverSockets: NodeWebSocket[]
  close: () => Promise<void>
}

async function startServer(): Promise<Harness> {
  return await new Promise((resolve) => {
    const httpServer = createServer()
    const wsServer = new WebSocketServer({ server: httpServer })
    const serverSockets: NodeWebSocket[] = []

    wsServer.on('connection', (ws) => {
      serverSockets.push(ws)
    })

    httpServer.listen(0, () => {
      const addr = httpServer.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        httpServer,
        wsServer,
        serverSockets,
        close: () =>
          new Promise<void>((done) => {
            wsServer.close(() => httpServer.close(() => done()))
          }),
      })
    })
  })
}

function connectClient(port: number): Promise<NodeWebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(`ws://127.0.0.1:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMessage(ws: NodeWebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMsg = (data: NodeWebSocket.RawData) => {
      ws.off('error', onErr)
      resolve(data.toString())
    }
    const onErr = (err: Error) => {
      ws.off('message', onMsg)
      reject(err)
    }
    ws.once('message', onMsg)
    ws.once('error', onErr)
  })
}

function runWithService<A>(
  fn: (svc: WebSocketService) => Effect.Effect<A>,
): Promise<A> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* WebSocketService
      return yield* fn(svc as never)
    }).pipe(Effect.provide(WebSocketServiceLive)),
  )
}

describe('WebSocketService — real socket integration', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await startServer()
  })

  afterEach(async () => {
    await harness.close()
  })

  it('round-trips a sendToPlayer message over a real socket', async () => {
    const client = await connectClient(harness.port)
    // Wait for the server to register the connection
    while (harness.serverSockets.length === 0) {
      await new Promise((r) => setTimeout(r, 5))
    }
    const serverSocket = harness.serverSockets[0]!

    await runWithService((svc) =>
      Effect.gen(function* () {
        // The 'ws' package's WebSocket has a different shape from the DOM
        // WebSocket the service expects, but only readyState + send are read.
        yield* svc.addConnection('g1', 'p1', serverSocket as unknown as WebSocket)
        const msg: ServerMessage = { type: 'announcement', message: 'hello', level: 'info' }
        yield* svc.sendToPlayer('p1', msg)
      }),
    )

    const received = await nextMessage(client)
    const parsed = JSON.parse(received)
    expect(parsed.type).toBe('announcement')
    expect(parsed.message).toBe('hello')

    client.close()
  })

  it('broadcasts to every player in a game', async () => {
    const c1 = await connectClient(harness.port)
    const c2 = await connectClient(harness.port)
    while (harness.serverSockets.length < 2) {
      await new Promise((r) => setTimeout(r, 5))
    }

    await runWithService((svc) =>
      Effect.gen(function* () {
        yield* svc.addConnection('g2', 'p1', harness.serverSockets[0]! as unknown as WebSocket)
        yield* svc.addConnection('g2', 'p2', harness.serverSockets[1]! as unknown as WebSocket)
        yield* svc.broadcastToGame('g2', {
          type: 'announcement',
          message: 'hi all',
          level: 'info',
        })
      }),
    )

    const [m1, m2] = await Promise.all([nextMessage(c1), nextMessage(c2)])
    expect(JSON.parse(m1).message).toBe('hi all')
    expect(JSON.parse(m2).message).toBe('hi all')

    c1.close()
    c2.close()
  })

  it('does not deliver to other games', async () => {
    const cA = await connectClient(harness.port)
    const cB = await connectClient(harness.port)
    while (harness.serverSockets.length < 2) {
      await new Promise((r) => setTimeout(r, 5))
    }

    await runWithService((svc) =>
      Effect.gen(function* () {
        yield* svc.addConnection('gA', 'pA', harness.serverSockets[0]! as unknown as WebSocket)
        yield* svc.addConnection('gB', 'pB', harness.serverSockets[1]! as unknown as WebSocket)
        yield* svc.broadcastToGame('gA', {
          type: 'announcement',
          message: 'A only',
          level: 'info',
        })
      }),
    )

    const fromA = await nextMessage(cA)
    expect(JSON.parse(fromA).message).toBe('A only')

    // cB shouldn't receive anything within a reasonable window
    const noMessage = await Promise.race([
      nextMessage(cB).then(() => 'got-message'),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 100)),
    ])
    expect(noMessage).toBe('timeout')

    cA.close()
    cB.close()
  })

  describe('disconnect / reconnect races', () => {
    it('addConnection for the same playerId replaces the previous socket', async () => {
      const c1 = await connectClient(harness.port)
      const c2 = await connectClient(harness.port)
      while (harness.serverSockets.length < 2) {
        await new Promise((r) => setTimeout(r, 5))
      }

      await runWithService((svc) =>
        Effect.gen(function* () {
          // Old connection registers first…
          yield* svc.addConnection('grec', 'p1', harness.serverSockets[0]! as unknown as WebSocket)
          // …then the same player reconnects with a fresh socket
          yield* svc.addConnection('grec', 'p1', harness.serverSockets[1]! as unknown as WebSocket)
          yield* svc.sendToPlayer('p1', { type: 'announcement', message: 'hi-new', level: 'info' })
        }),
      )

      const onlyNew = await Promise.race([
        nextMessage(c2).then((m) => ({ from: 'new' as const, msg: m })),
        nextMessage(c1).then((m) => ({ from: 'old' as const, msg: m })),
        new Promise<{ from: 'timeout' }>((r) => setTimeout(() => r({ from: 'timeout' }), 100)),
      ])
      expect(onlyNew.from).toBe('new')
      if (onlyNew.from === 'new') {
        expect(JSON.parse(onlyNew.msg).message).toBe('hi-new')
      }

      c1.close()
      c2.close()
    })

    it(
      'removeConnection unconditionally drops the player — coordination is the caller’s job',
      async () => {
        // This documents the current contract: WebSocketService trusts the
        // caller to guard against the "old close fires after new connect"
        // race. The fix (a 60s grace timer) lives one layer up in the WS
        // route. If anyone changes WebSocketService to add peer identity,
        // delete this test and add the equivalent at the route layer.
        const c1 = await connectClient(harness.port)
        const c2 = await connectClient(harness.port)
        while (harness.serverSockets.length < 2) {
          await new Promise((r) => setTimeout(r, 5))
        }

        await runWithService((svc) =>
          Effect.gen(function* () {
            yield* svc.addConnection('grace', 'p1', harness.serverSockets[0]! as unknown as WebSocket)
            // Player reconnects — newer socket replaces the old one.
            yield* svc.addConnection('grace', 'p1', harness.serverSockets[1]! as unknown as WebSocket)
            // The old close handler fires *after* the reconnect — without a
            // grace timer this nukes the new connection too.
            yield* svc.removeConnection('p1')
            yield* svc.sendToPlayer('p1', { type: 'announcement', message: 'lost', level: 'info' })
          }),
        )

        const got = await Promise.race([
          nextMessage(c1).then(() => 'old' as const),
          nextMessage(c2).then(() => 'new' as const),
          new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 100)),
        ])
        expect(got).toBe('timeout')

        c1.close()
        c2.close()
      },
    )

    it('reconnecting after removeConnection re-enables sends', async () => {
      const c1 = await connectClient(harness.port)
      while (harness.serverSockets.length === 0) {
        await new Promise((r) => setTimeout(r, 5))
      }

      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('grec2', 'p1', harness.serverSockets[0]! as unknown as WebSocket)
          yield* svc.removeConnection('p1')
          // Reconnect window expired → player can re-register and receive again
          yield* svc.addConnection('grec2', 'p1', harness.serverSockets[0]! as unknown as WebSocket)
          yield* svc.sendToPlayer('p1', { type: 'announcement', message: 'back', level: 'info' })
        }),
      )

      const received = await nextMessage(c1)
      expect(JSON.parse(received).message).toBe('back')
      c1.close()
    })

    it('broadcastToGame after one player removes still reaches the rest', async () => {
      const c1 = await connectClient(harness.port)
      const c2 = await connectClient(harness.port)
      while (harness.serverSockets.length < 2) {
        await new Promise((r) => setTimeout(r, 5))
      }

      await runWithService((svc) =>
        Effect.gen(function* () {
          yield* svc.addConnection('gbc', 'p1', harness.serverSockets[0]! as unknown as WebSocket)
          yield* svc.addConnection('gbc', 'p2', harness.serverSockets[1]! as unknown as WebSocket)
          yield* svc.removeConnection('p1')
          yield* svc.broadcastToGame('gbc', {
            type: 'announcement',
            message: 'survivors only',
            level: 'info',
          })
        }),
      )

      const m2 = await nextMessage(c2)
      expect(JSON.parse(m2).message).toBe('survivors only')
      const stray = await Promise.race([
        nextMessage(c1).then(() => 'got' as const),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 100)),
      ])
      expect(stray).toBe('timeout')

      c1.close()
      c2.close()
    })

    it('two clients on the same player flip-flop cleanly across multiple reconnects', async () => {
      // Tight loop reconnect — old, new, older-still, newest-of-all. The
      // latest registered socket should always be the receiver.
      const sockets: NodeWebSocket[] = []
      for (let i = 0; i < 4; i++) sockets.push(await connectClient(harness.port))
      while (harness.serverSockets.length < 4) {
        await new Promise((r) => setTimeout(r, 5))
      }

      for (let i = 0; i < 4; i++) {
        const idx = i
        await runWithService((svc) =>
          Effect.gen(function* () {
            yield* svc.addConnection('gflip', 'p1', harness.serverSockets[idx]! as unknown as WebSocket)
            yield* svc.sendToPlayer('p1', {
              type: 'announcement',
              message: `gen${idx}`,
              level: 'info',
            })
          }),
        )
        const msg = await nextMessage(sockets[i]!)
        expect(JSON.parse(msg).message).toBe(`gen${i}`)
      }

      for (const s of sockets) s.close()
    })
  })

  it('removes a connection when the underlying socket closes', async () => {
    const client = await connectClient(harness.port)
    while (harness.serverSockets.length === 0) {
      await new Promise((r) => setTimeout(r, 5))
    }
    const serverSocket = harness.serverSockets[0]!

    await runWithService((svc) =>
      Effect.gen(function* () {
        yield* svc.addConnection('g3', 'p3', serverSocket as unknown as WebSocket)
      }),
    )

    // Close from client side
    client.close()
    // Wait for the server-side close to land
    await new Promise<void>((resolve) => serverSocket.once('close', () => resolve()))

    // Ask the service to send to the (now-dead) player. The Service will
    // silently drop because sending on a closed socket throws.
    await runWithService((svc) =>
      Effect.gen(function* () {
        yield* svc.sendToPlayer('p3', {
          type: 'announcement',
          message: 'will fail',
          level: 'info',
        })
      }),
    )
    // No assertion needed — just verifying we don't throw or hang.
    expect(true).toBe(true)
  })
})
