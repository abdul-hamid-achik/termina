#!/usr/bin/env bun
/**
 * Run the Cairntrace e2e suite, managing the dev server lifecycle.
 *
 * Cairntrace does not start the app, so this script:
 *  - reuses an already-running server on :3000 if there is one, otherwise
 *  - starts `bun run dev` with TERMINA_TEST_HOOKS=1 (inheriting any DB/Redis env),
 *    waits for it, runs the suite, then tears down the server it started.
 *
 * Diagnostics & safety (so CI failures are debuggable and never hang):
 *  - the dev server's stdout/stderr are captured to `e2e-dev-server.log` (CI
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
const DEV_LOG = resolve(process.cwd(), 'e2e-dev-server.log')
const CAIRN_BUDGET_MS = Number(process.env.CAIRN_BUDGET_MS ?? 12 * 60 * 1000)
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
  console.log(`[e2e] starting dev server (TERMINA_TEST_HOOKS=1); logging to ${DEV_LOG} …`)
  // Write the child's stdout/stderr straight to a file descriptor — same shape
  // as stdio:'ignore' (which exited cleanly), just to a file instead of
  // /dev/null. Avoid JS-side stream piping (.pipe()), which keeps handles open
  // and made process.exit() get SIGKILL'd even on success.
  const logFd = openSync(DEV_LOG, 'w')
  // detached → its own process group, so teardown can kill the whole tree
  // (bun → nitro worker). unref() so this live child never pins our event loop
  // and force process.exit() to be SIGKILL'd (the cause of a spurious 137 even
  // on a passing run).
  devChild = spawn('bun', ['run', 'dev'], {
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: {
      ...process.env,
      // Bind IPv4 explicitly — Nuxt/listhen defaults to IPv6 (::1), which makes
      // a Bun `fetch` to 127.0.0.1 (or an IPv4-resolved localhost) hit a dead
      // address and hang on the CI runner. Keep the whole chain on 127.0.0.1.
      HOST: '127.0.0.1',
      TERMINA_TEST_HOOKS: '1',
      TERMINA_TEST_FAST_GAME: process.env.TERMINA_TEST_FAST_GAME ?? '8',
    },
  })
  devChild.unref()
  startedServer = true
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (await isUp()) break
    await sleep(2000)
  }
  if (!(await isUp())) {
    console.error('[e2e] dev server did not come up on :3000')
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
