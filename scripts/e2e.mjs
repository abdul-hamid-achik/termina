#!/usr/bin/env bun
/**
 * Run the Cairntrace e2e suite, managing the dev server lifecycle.
 *
 * Cairntrace does not start the app, so this script:
 *  - reuses an already-running server on :3000 if there is one, otherwise
 *  - starts `bun run dev` with TERMINA_TEST_HOOKS=1 (inheriting any DB/Redis env),
 *    waits for it, runs the suite, then tears down the server it started.
 *
 * Any extra args are passed through to `cairn run` (e.g. --junit --stamp-if-green,
 * or a single flow path). Requires the `cairn` CLI on PATH.
 */
import { spawn } from 'node:child_process'

const BASE = 'http://localhost:3000'
const passthrough = process.argv.slice(2)
const target = passthrough.find((a) => !a.startsWith('-')) ?? 'tests/e2e/flows'
const flags = passthrough.filter((a) => a.startsWith('-'))

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
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts })
    p.on('exit', (code) => resolve(code ?? 1))
    p.on('error', () => resolve(127))
  })
}

const alreadyUp = await isUp()
let startedServer = false

if (!alreadyUp) {
  console.log('[e2e] starting dev server (TERMINA_TEST_HOOKS=1) …')
  spawn('bun', ['run', 'dev'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      TERMINA_TEST_HOOKS: '1',
      TERMINA_TEST_FAST_GAME: process.env.TERMINA_TEST_FAST_GAME ?? '8',
    },
  })
  startedServer = true
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (await isUp()) break
    await sleep(2000)
  }
  if (!(await isUp())) {
    console.error('[e2e] dev server did not come up on :3000')
    await sh('sh', ['-c', 'lsof -ti :3000 | xargs kill -9 2>/dev/null || true'])
    process.exit(1)
  }
} else {
  console.log('[e2e] reusing the server already running on :3000')
}

// Best-effort: clear seeded games from the test Redis so runs don't pile up.
await sh('sh', ['-c', 'redis-cli -n 1 FLUSHDB >/dev/null 2>&1 || true'])

// CI sets CAIRN_BACKEND=playwright (the agent-browser daemon isn't available there).
const backendFlags = process.env.CAIRN_BACKEND ? ['--backend', process.env.CAIRN_BACKEND] : []

const code = await sh('cairn', [
  'run',
  target,
  '--config',
  'tests/e2e/cairntrace.config.yml',
  '--cold-start',
  ...backendFlags,
  ...flags,
])

if (startedServer) {
  await sh('sh', ['-c', 'lsof -ti :3000 | xargs kill -9 2>/dev/null || true'])
}
process.exit(code)
