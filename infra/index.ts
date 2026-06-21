/**
 * Termina — DigitalOcean infrastructure (Pulumi, TypeScript).
 *
 * Topology (see ./README.md for the full rationale):
 *   - Vercel hosts the Nuxt frontend SPA AND provisions the data layer
 *     (Neon Postgres + Upstash Redis) via the Vercel Marketplace.
 *   - DigitalOcean App Platform runs the full Nitro server (SSR + WebSocket +
 *     Effect-TS game loop + API) from a Docker image in DOCR.
 *   - The data-layer connection strings are passed in here as *secrets* —
 *     this stack does not own Neon/Upstash.
 *
 * Why App Platform (vs Droplets+LB or DOKS): lowest ops for this scale, native
 * TLS + health checks + rolling deploys, and trivial vertical/horizontal scaling.
 * The in-process game state pins a game to one instance, but the Redis relay
 * (game_owner / player_location / action queue) keeps multi-instance *correct*
 * even without sticky sessions. The compute layer is the only thing defined
 * here, so it can be swapped for Droplets+LB / DOKS later without touching the
 * data or secret model.
 *
 * Secrets: resolved env-var-first, then Pulumi config. The env path is what
 * makes `tvault run -- pulumi up` work — tvault injects each secret under its
 * real env name (NUXT_* / DIGITALOCEAN_TOKEN), this stack reads it, and
 * pulumi.secret() keeps it encrypted in state. The Pulumi-config path is the
 * fallback for environments without tvault (CI identity reads, plain Pulumi).
 */
import * as pulumi from '@pulumi/pulumi'
import * as digitalocean from '@pulumi/digitalocean'

const config = new pulumi.Config()
const stack = pulumi.getStack()

// ── Non-secret config (set in Pulumi.<stack>.yaml; sensible defaults here) ──
const region = config.get('region') ?? 'nyc'
const appName = config.get('appName') ?? `termina-ws-${stack}`
const instanceCount = config.getNumber('instanceCount') ?? 1
const instanceSize = config.get('instanceSize') ?? 'basic-xxs'
const imageRepository = config.get('imageRepository') ?? 'termina-ws'
// The deployed image version. CI pushes `:<git-sha>` to DOCR, then sets this via
// `pulumi config set termina-infra:imageTag <sha>` so Pulumi owns the live tag.
const imageTag = config.get('imageTag') ?? 'latest'
const registryName = config.get('registryName') ?? 'termina'
// Opt in to let Pulumi create+own the DOCR registry. Default false: a DOCR
// registry is account-global and usually already exists, so we reference it by
// name. Flip to true (and `pulumi import` if it exists) to manage it here.
const createRegistry = config.getBoolean('createRegistry') ?? false
const registryTier = config.get('registryTier') ?? 'basic'
// Opt in to group the App under a named DigitalOcean Project (org/billing
// clarity) instead of the account's default project.
const createProject = config.getBoolean('createProject') ?? false
const projectName = config.get('projectName') ?? 'termina'
const projectEnvironment = config.get('projectEnvironment') ?? 'Production'

// ── Secret resolution: env var (tvault-injected) → Pulumi config ──
function requiredSecret(envName: string, configKey: string): pulumi.Output<string> {
  const fromEnv = process.env[envName]
  return fromEnv ? pulumi.secret(fromEnv) : config.requireSecret(configKey)
}

function optionalSecretEnv(
  envName: string,
  configKey: string,
): digitalocean.types.input.AppSpecServiceEnv[] {
  const fromEnv = process.env[envName]
  const value = fromEnv ? pulumi.secret(fromEnv) : config.getSecret(configKey)
  return value ? [{ key: envName, value, scope: 'RUN_TIME', type: 'SECRET' }] : []
}

// Required — the server cannot boot without these.
const sessionPassword = requiredSecret('NUXT_SESSION_PASSWORD', 'sessionPassword')
const databaseUrl = requiredSecret('NUXT_DATABASE_URL', 'databaseUrl') // Neon (via Vercel)
const redisUrl = requiredSecret('NUXT_REDIS_URL', 'redisUrl') // Upstash (via Vercel)

// ── Optional: Pulumi-managed DOCR registry ──────────────────────────────────
const registry = createRegistry
  ? new digitalocean.ContainerRegistry('termina-registry', {
      name: registryName,
      subscriptionTierSlug: registryTier,
      region,
    })
  : undefined

// ── App Platform service env ────────────────────────────────────────────────
const envs: digitalocean.types.input.AppSpecServiceEnv[] = [
  { key: 'NODE_ENV', value: 'production', scope: 'RUN_TIME', type: 'GENERAL' },
  { key: 'HOST', value: '0.0.0.0', scope: 'RUN_TIME', type: 'GENERAL' },
  { key: 'PORT', value: '3000', scope: 'RUN_TIME', type: 'GENERAL' },
  { key: 'NUXT_SESSION_PASSWORD', value: sessionPassword, scope: 'RUN_TIME', type: 'SECRET' },
  { key: 'NUXT_DATABASE_URL', value: databaseUrl, scope: 'RUN_TIME', type: 'SECRET' },
  { key: 'NUXT_REDIS_URL', value: redisUrl, scope: 'RUN_TIME', type: 'SECRET' },
  ...optionalSecretEnv('NUXT_OAUTH_GITHUB_CLIENT_ID', 'githubClientId'),
  ...optionalSecretEnv('NUXT_OAUTH_GITHUB_CLIENT_SECRET', 'githubClientSecret'),
  ...optionalSecretEnv('NUXT_OAUTH_DISCORD_CLIENT_ID', 'discordClientId'),
  ...optionalSecretEnv('NUXT_OAUTH_DISCORD_CLIENT_SECRET', 'discordClientSecret'),
]

// ── App Platform service ────────────────────────────────────────────────────
// The full Nitro server: SSR + WS + game engine + API on one HTTP port. App
// Platform terminates TLS and upgrades WebSocket connections to this port.
const app = new digitalocean.App('termina-ws', {
  spec: {
    name: appName,
    region,
    // Ops alerts → the DO team's notification email by default (no destinations
    // block needed). App-level: deploy + domain failures.
    alerts: [{ rule: 'DEPLOYMENT_FAILED' }, { rule: 'DOMAIN_FAILED' }],
    services: [
      {
        name: 'web',
        httpPort: 3000,
        instanceCount,
        instanceSizeSlug: instanceSize,
        image: {
          registryType: 'DOCR',
          repository: imageRepository,
          tag: imageTag,
        },
        healthCheck: {
          httpPath: '/api/health',
          initialDelaySeconds: 15,
          periodSeconds: 30,
          timeoutSeconds: 5,
          failureThreshold: 3,
        },
        // Per-service alerts: crash-loop (restart count) + memory pressure — the
        // long-lived game-loop process is where a leak would surface.
        alerts: [
          { rule: 'RESTART_COUNT', operator: 'GREATER_THAN', value: 3, window: 'FIVE_MINUTES' },
          { rule: 'MEM_UTILIZATION', operator: 'GREATER_THAN', value: 90, window: 'FIVE_MINUTES' },
        ],
        envs,
      },
    ],
  },
})

// ── Optional: group resources under a named DO Project ──────────────────────
const project = createProject
  ? new digitalocean.Project('termina', {
      name: projectName,
      description: 'Termina MOBA — game server + container registry.',
      purpose: 'Web Application',
      environment: projectEnvironment,
      resources: [pulumi.interpolate`do:app:${app.id}`],
    })
  : undefined

// ── Outputs ─────────────────────────────────────────────────────────────────
export const appId = app.id
export const appLiveUrl = app.liveUrl
export const appDefaultIngress = app.defaultIngress
export const registryEndpoint = registry?.endpoint
export const projectId = project?.id

// Convenience values to set on the Vercel frontend so the SPA can reach this
// server: NUXT_PUBLIC_API_URL=<https> and NUXT_PUBLIC_WS_URL=<wss>.
export const vercelApiUrl = app.liveUrl
export const vercelWsUrl = app.liveUrl.apply((url) => url.replace(/^https:\/\//, 'wss://'))
