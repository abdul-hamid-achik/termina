#!/usr/bin/env bun
/**
 * Run the Cairntrace e2e suite, managing the app server lifecycle.
 *
 * Cairntrace does not start the app, so this script:
 *  - reuses an already-running server on :3000 if there is one, otherwise
 *  - builds the app if needed and starts the PRODUCTION PREVIEW server
 *    (`node .output/server`) with TERMINA_TEST_HOOKS=1 (inheriting any DB/Redis
 *    env), waits for it, runs the suite, then tears down the server it started.
 *    The prod preview (not `nuxt dev`) avoids the dev server's Vite-proxy /
 *    cold-compile / IPv6 flakiness; the hooks gate on TERMINA_TEST_HOOKS=1 so
 *    they work in the prod build. Set E2E_REBUILD=1 to force a rebuild.
 *
 * Diagnostics & safety (so CI failures are debuggable and never hang):
 *  - the server's stdout/stderr are captured to `e2e-dev-server.log` (CI
 *    uploads it as an artifact) instead of being discarded — that log is the
 *    only place that explains a server-side rejection (e.g. a 400 from a hook).
 *  - the `cairn run` is wrapped in a watchdog (CAIRN_BUDGET_MS, default 12m): if
 *    it produces no exit in time it's killed, the dev-server log tail is dumped,
 *    and the script exits 124 — turning a silent multi-minute hang into a fast,
 *    diagnosable failure.
 *
 * Any extra args are passed through to `cairn run` (e.g. --junit --stamp-if-green,
 * or a single flow path). Requires the `cairn` CLI on PATH.
 */
import { spawn } from 'node:child_process'
import { openSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// IPv4, not localhost — the dev server is forced to bind 127.0.0.1 (HOST below)
// so cairn's request transport (a Bun fetch) and our health checks stay on IPv4.
// A `localhost` that resolves to IPv6 (::1) on a Linux runner is what hung CI.
const BASE = 'http://127.0.0.1:3000'
// The e2e server is a PRODUCTION PREVIEW build (node .output/server), not the
// dev server: bundled assets, native WS, IPv4 bind — none of the dev server's
// Vite-proxy / cold-compile / IPv6 flakiness. The test hooks gate on the
// explicit TERMINA_TEST_HOOKS=1 opt-in, so they work in the prod build too.
const OUTPUT_SERVER = resolve(process.cwd(), '.output/server/index.mjs')
const DEV_LOG = resolve(process.cwd(), 'e2e-dev-server.log')
// 15 min default: 4-way parallel runs the full suite in ~11-12 min; the extra
// margin absorbs the heaviest spec (smoke_full_session, ~2.5 min) and cold-start
// browser spin-up. Still a hard ceiling so a genuine hang can't run forever.
const CAIRN_BUDGET_MS = Number(process.env.CAIRN_BUDGET_MS ?? 15 * 60 * 1000)
const JUNIT_PATH = 'tests/e2e/junit.xml'

// Parse passthrough args into the positional spec target + the flags to forward
// to `cairn run`. cairn flags that take a value must keep that value attached
// (a naive "first non-dash arg = target" split would mistake `--junit <file>`'s
// path for the spec target). `--junit` with no value (e.g. `test:e2e:ci` passes
// `--junit --stamp-if-green`) is given a concrete path so cairn doesn't error.
const VALUE_FLAGS = new Set([
  '--junit',
  '--config',
  '--backend',
  '--artifact-root',
  '--parallel',
  '--env',
  '--format',
  '--var',
])
const passthrough = process.argv.slice(2)
const positionals = []
const flags = []
for (let i = 0; i < passthrough.length; i++) {
  const a = passthrough[i]
  if (!a.startsWith('-')) {
    positionals.push(a)
    continue
  }
  flags.push(a)
  const next = passthrough[i + 1]
  if (VALUE_FLAGS.has(a)) {
    if (next !== undefined && !next.startsWith('-')) {
      flags.push(next)
      i++
    } else if (a === '--junit') {
      flags.push(JUNIT_PATH) // valueless --junit → write to a known path
    }
  }
}
const target = positionals[0] ?? 'tests/e2e/flows'

// Run specs concurrently by default so the full suite finishes within the
// watchdog budget. Sequential cold-start is ~65s/spec → ~31 min for ~32 flows,
// which always tripped the 12-min watchdog mid-suite and read as a "hang at
// game_scoreboard" (the run simply never REACHED scoreboard). 4-way parallel
// finishes the whole suite — all 32 flows green — in ~11-12 min. cairntrace v1.9
// per-run identity (testUser: cairn_${run.token}) keeps concurrent specs
// isolated, so they don't clobber each other's seeded games. Override with
// E2E_PARALLEL=<n> (set 1 to force sequential), or pass an explicit --parallel.
const E2E_PARALLEL = process.env.E2E_PARALLEL ?? '4'
if (!flags.includes('--parallel') && E2E_PARALLEL !== '1') {
  flags.push('--parallel', E2E_PARALLEL)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function isUp() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) })
    return r.status > 0
  } catch {
    return false
  }
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolve_) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts })
    p.on('exit', (code) => resolve_(code ?? 1))
    p.on('error', () => resolve_(127))
  })
}

/** Run a command with a hard wall-clock budget. Resolves to the exit code, or
 *  124 if the budget elapsed first (the child is SIGTERM'd then SIGKILL'd). */
function runWithBudget(cmd, args, budgetMs, opts = {}) {
  return new Promise((resolve_) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      console.error(
        `\n[e2e] '${cmd}' exceeded ${Math.round(budgetMs / 1000)}s budget — killing it.`,
      )
      p.kill('SIGTERM')
      setTimeout(() => p.kill('SIGKILL'), 5000)
    }, budgetMs)
    p.on('exit', (code) => {
      clearTimeout(timer)
      resolve_(timedOut ? 124 : (code ?? 1))
    })
    p.on('error', () => {
      clearTimeout(timer)
      resolve_(127)
    })
  })
}

function dumpDevLog(label) {
  if (!existsSync(DEV_LOG)) return
  try {
    const lines = readFileSync(DEV_LOG, 'utf8').split('\n')
    const tail = lines.slice(-80).join('\n')
    console.error(
      `\n[e2e] ===== dev server log tail (${label}) =====\n${tail}\n[e2e] ===== end dev server log =====`,
    )
  } catch {
    /* best-effort */
  }
}

const alreadyUp = await isUp()
let startedServer = false
let devChild

/** Kill the dev server we started (whole process group), best-effort. */
async function teardownDevServer() {
  if (!startedServer) return
  if (devChild?.pid) {
    try {
      process.kill(-devChild.pid, 'SIGKILL')
    } catch {
      /* group already gone */
    }
  }
  // `-sTCP:LISTEN` is critical: a bare `lsof -ti :3000` also returns OUR OWN pid
  // (this script holds keep-alive client sockets to :3000 from the isUp() fetch
  // health checks), so `xargs kill -9` would SIGKILL the script itself (a
  // spurious 137 even on a green run). Restrict the kill to the listener.
  await sh('sh', ['-c', 'lsof -ti :3000 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true'])
}

if (!alreadyUp) {
  // Flush the test Redis BEFORE the server boots: seeded games persist in db1
  // and the game server reloads (and keeps ticking) them on startup, so a stale
  // db1 means a fresh server inherits a pile of zombie games. CI's Redis is
  // always fresh, so this only matters for repeated local runs — but it keeps
  // the local server as clean as CI's. (Reuse path: don't touch a server we
  // didn't start — its in-memory games would survive a flush anyway.)
  await sh('sh', ['-c', 'redis-cli -n 1 FLUSHDB >/dev/null 2>&1 || true'])

  // Ensure a production build exists; build if missing (or E2E_REBUILD=1 forces it).
  if (process.env.E2E_REBUILD === '1' || !existsSync(OUTPUT_SERVER)) {
    console.log('[e2e] building the app for the preview server (bun run build) …')
    const buildCode = await sh('bun', ['run', 'build'])
    if (buildCode !== 0 || !existsSync(OUTPUT_SERVER)) {
      console.error('[e2e] build failed — cannot start preview server')
      process.exit(1)
    }
  }

  console.log(
    `[e2e] starting preview server (node .output/server, TERMINA_TEST_HOOKS=1); logging to ${DEV_LOG} …`,
  )
  // Write the child's stdout/stderr straight to a file descriptor (no .pipe(),
  // which keeps handles open and made process.exit() get SIGKILL'd). detached +
  // unref so teardown can kill the whole group and the live child never pins our
  // event loop.
  const logFd = openSync(DEV_LOG, 'w')
  devChild = spawn('node', [OUTPUT_SERVER], {
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: {
      ...process.env,
      // Bind IPv4 explicitly (the Nitro node server honors HOST) so the whole
      // chain stays on 127.0.0.1 — a localhost that resolves to IPv6 (::1) is
      // what hung CI.
      HOST: '127.0.0.1',
      PORT: '3000',
      TERMINA_TEST_HOOKS: '1',
      TERMINA_TEST_FAST_GAME: process.env.TERMINA_TEST_FAST_GAME ?? '8',
      // The prod build sets the session cookie `secure: true` (NODE_ENV=production),
      // which the client won't send over plain HTTP (127.0.0.1) — so the login-as
      // session wouldn't carry to the next hook and seeding 401s. Override the
      // runtimeConfig flag off for the HTTP preview (test-only).
      NUXT_SESSION_COOKIE_SECURE: 'false',
      // The prod build requires these at runtime (no dev auto-defaults). CI sets
      // them; locally fall back to the test DB/redis + a throwaway session key.
      NUXT_SESSION_PASSWORD:
        process.env.NUXT_SESSION_PASSWORD ?? 'e2e_session_password_at_least_32_chars_long',
      NUXT_DATABASE_URL:
        process.env.NUXT_DATABASE_URL ?? 'postgresql://termina:termina@localhost:5432/termina',
      NUXT_REDIS_URL: process.env.NUXT_REDIS_URL ?? 'redis://localhost:6379/1',
    },
  })
  devChild.unref()
  startedServer = true
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await isUp()) break
    await sleep(1000)
  }
  if (!(await isUp())) {
    console.error('[e2e] preview server did not come up on :3000')
    dumpDevLog('startup failure')
    await teardownDevServer()
    process.exit(1)
  }
} else {
  console.log('[e2e] reusing the server already running on :3000')
}

// Best-effort: clear seeded games from the test Redis so runs don't pile up.
await sh('sh', ['-c', 'redis-cli -n 1 FLUSHDB >/dev/null 2>&1 || true'])

// CI sets CAIRN_BACKEND=playwright (the agent-browser daemon isn't available there).
const backendFlags = process.env.CAIRN_BACKEND ? ['--backend', process.env.CAIRN_BACKEND] : []

const code = await runWithBudget(
  'cairn',
  [
    'run',
    target,
    '--config',
    'tests/e2e/cairntrace.config.yml',
    '--cold-start',
    ...backendFlags,
    ...flags,
  ],
  CAIRN_BUDGET_MS,
)

// On any non-clean exit, surface the server log so CI failures are diagnosable
// without re-running locally (the artifact upload keeps the full file too).
if (code !== 0) dumpDevLog(code === 124 ? 'watchdog timeout' : `cairn exit ${code}`)

await teardownDevServer()
process.exit(code)
