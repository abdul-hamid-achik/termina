# P4: Multi-Instance Redis Migration — Design

## Goal

Move in-process game/lobby/peer state to Redis so multiple DigitalOcean
instances can share state and deliver messages across instance boundaries.

## Current state (single-instance)

| State | Location | Multi-instance safe? |
|-------|----------|-----------------------|
| `liveGames` (game state + recent events) | In-process `Map` | No — instance B can't see instance A's games |
| `PeerRegistry` (playerId → WS peer) | In-process `Map` | No — `sendToPeer` fails if player is on another instance |
| `WebSocketService` (gameId → connections) | In-process `Map` | No — broadcasts only reach local connections |
| `activeLobbies` (lobby state) | In-process `Map` | No — picks can't span instances |
| `gameActionQueues` | In-process `Map` | No — actions submitted to the wrong instance are lost |
| `recentHeroDamage` | In-process `Map` | No — assist tracking is per-instance |
| `comboStates` (bot AI) | In-process `Map` | No — but bots are per-game, so OK if game runs on one instance |
| Matchmaking lock | Redis (Lua compare-and-delete) | ✅ (fixed in Workstream D) |
| Queue (sorted set) | Redis | ✅ |
| `liveGames` reaper | In-process sweep | ✅ (fixed in Workstream D — local foundation) |

## Architecture

### Instance identity

Each DO instance gets a unique `INSTANCE_ID` (generated on boot, e.g.
`inst_${crypto.randomUUID()}`). This is used as the relay channel suffix and
the player-location hash value.

### Player location tracking

Redis hash `termina:player_location`:
- `HSET termina:player_location ${playerId} ${INSTANCE_ID}` on WS open
- `HDEL termina:player_location ${playerId}` on WS close (after grace)
- `HGET termina:player_location ${playerId}` to find which instance holds a player

### Cross-instance message relay

Each instance subscribes to `termina:relay:${INSTANCE_ID}`.

When `sendToPeer(playerId, msg)` finds no local peer:
1. `HGET termina:player_location ${playerId}` → target instance ID
2. `PUBLISH termina:relay:${targetInstanceId} ${JSON.stringify({playerId, msg})}`
3. The target instance's relay subscriber receives it, looks up the local
   `PeerRegistry`, and delivers the message

This adds one Redis round-trip per cross-instance message. The P3 delta
compression keeps the payload small.

### Game ownership

Redis hash `termina:game_owner`:
- `HSET termina:game_owner ${gameId} ${INSTANCE_ID}` on game creation
- `HGET termina:game_owner ${gameId}` to find which instance runs the loop
- `HDEL termina:game_owner ${gameId}` on game over

The matchmaking `game_ready` publisher doesn't care which instance picks it up
— the first instance to subscribe creates the game and claims ownership.

### Game state (read-only access for reconnect/spectate)

Currently `liveGames` holds the in-memory state manager + recent events. For
cross-instance reconnect, instance B needs to read the game state from
instance A. Options:

**Option A: State in Redis (full migration)**
- Serialize the full `GameState` to Redis on every tick (expensive — the state
  is large, even with delta compression)
- Reconnect reads from Redis (any instance can serve it)

**Option B: Relay reconnect to the owning instance**
- `HGET termina:game_owner ${gameId}` → owner instance
- `PUBLISH termina:relay:${ownerInstanceId} ${JSON.stringify({type: 'reconnect_request', playerId, gameId, lastTick})}`
- The owner instance builds the reconnect payload and relays it back via
  `termina:relay:${requesterInstanceId}`

Option B is cheaper (only on reconnect, not every tick) and doesn't require
serializing the full state to Redis. Recommended.

### Lobby state

Move `activeLobbies` to Redis:
- `SET termina:lobby:${lobbyId} ${JSON.stringify(lobbyState)}` on create
- `GET termina:lobby:${lobbyId}` on pick/status
- `DEL termina:lobby:${lobbyId}` on game creation / cancel

The pick timer (`setTimeout`) is per-instance — the instance that created the
lobby runs the timer. If that instance dies, the lobby is orphaned (the reaper
from Workstream D can be extended to sweep stale lobbies).

### Action queue

`gameActionQueues` are per-game. The instance that owns the game drains the
queue. Actions submitted on a different instance need to be relayed:

- `LPUSH termina:actions:${gameId} ${JSON.stringify(action)}` instead of the
  in-process queue
- The owning instance `BRPOP` drains the queue (or polls on each tick)

## Implementation plan

### Phase 1: Instance identity + player location (small)
- Generate `INSTANCE_ID` on boot
- `HSET/HDEL termina:player_location` on WS open/close
- `HGET` in `sendToPeer` when no local peer

### Phase 2: Cross-instance relay (medium)
- Subscribe to `termina:relay:${INSTANCE_ID}` on boot
- `sendToPeer` publishes to the target instance's relay channel when no local peer
- Relay subscriber forwards to local `PeerRegistry.sendToPeer`

### Phase 3: Game ownership + reconnect relay (medium)
- `HSET/HDEL termina:game_owner` on game create/over
- Reconnect/request_state: `HGET` owner → relay request → relay response

### Phase 4: Lobby state in Redis (medium)
- Serialize `activeLobbies` to Redis
- All lobby operations read/write from Redis
- Lobby reaper for orphaned lobbies

### Phase 5: Action queue in Redis (small)
- Replace in-process `gameActionQueues` with Redis LPUSH/BRPOP
- The owning instance drains the queue each tick

## Risk assessment

- **Phase 1-2** are the highest value (enable cross-instance tick delivery)
  with the lowest risk (additive — no existing behavior changes)
- **Phase 3** enables cross-instance reconnect (important for HA)
- **Phase 4-5** are needed for true multi-instance matchmaking but can be
  deferred if the load balancer is sticky (routes by playerId to the owning
  instance, which DO App Platform supports via session affinity)

## Recommendation

Implement Phases 1-3 first (cross-instance delivery + reconnect). Defer 4-5
until session affinity is insufficient. The DO App Platform supports sticky
sessions, so Phases 1-3 + sticky routing may be enough for launch.