/**
 * Hero registry barrel — importing this module guarantees every hero's
 * `registerHero()` side effect has run before the engine resolves a cast.
 *
 * The engine (GameLoop, ActionResolver) must import hero helpers from here,
 * NOT from './_base' directly, or the per-hero resolvers never register and
 * `resolveAbility` fails with 'No resolver registered'.
 */
import './cache'
import './cipher'
import './cron'
import './daemon'
import './echo'
import './firewall'
import './kernel'
import './lambda'
import './malloc'
import './mutex'
import './null_ref'
import './ping'
import './proxy'
import './regex'
import './sentry'
import './socket'
import './thread'
import './traceroute'

export * from './_base'
export { TALENT_TREES } from './talent-trees'
