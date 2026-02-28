import { createConsola } from 'consola'

const isProduction = !import.meta.dev && process.env.NODE_ENV === 'production'

export const logger = createConsola({
  level: isProduction ? 3 : 4,
  defaults: {
    tag: 'termina',
  },
})

/** Scoped loggers for each server subsystem */
export const wsLog = logger.withTag('ws')
export const peerLog = logger.withTag('peer')
export const authLog = logger.withTag('auth')
export const matchLog = logger.withTag('match')
export const lobbyLog = logger.withTag('lobby')
export const gameLog = logger.withTag('game')
export const engineLog = logger.withTag('engine')
