import { Effect, Layer, Logger, LogLevel } from 'effect'

const isDev = import.meta.dev ?? process.env.NODE_ENV !== 'production'

export const gameLoggerLive = Layer.mergeAll(
  isDev ? Logger.pretty : Logger.json,
  isDev ? Logger.minimumLogLevel(LogLevel.Debug) : Logger.minimumLogLevel(LogLevel.Info),
)

export const withGameContext = (gameId: string) => Effect.annotateLogs({ gameId })

export const withPlayerContext = (gameId: string, playerId: string) =>
  Effect.annotateLogs({ gameId, playerId })
