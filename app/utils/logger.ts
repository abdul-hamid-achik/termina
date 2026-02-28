import { createConsola } from 'consola'

const isProduction = import.meta.env?.PROD ?? false

const logger = createConsola({
  level: isProduction ? 3 : 4, // 3 = info, 4 = debug
  defaults: {
    tag: 'termina',
  },
})

/** Scoped loggers for each frontend subsystem */
export const gameLog = logger.withTag('game')
export const socketLog = logger.withTag('socket')
export const lobbyLog = logger.withTag('lobby')
export const uiLog = logger.withTag('ui')
