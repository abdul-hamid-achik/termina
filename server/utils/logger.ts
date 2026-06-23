import { Layer, Logger, LogLevel } from 'effect'

const isDev = import.meta.dev ?? process.env.NODE_ENV !== 'production'

export const gameLoggerLive = Layer.mergeAll(
  isDev ? Logger.pretty : Logger.json,
  isDev ? Logger.minimumLogLevel(LogLevel.Debug) : Logger.minimumLogLevel(LogLevel.Info),
)
