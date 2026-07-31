/**
 * Player-facing presentation for engine buff/debuff ids.
 *
 * The engine stores effects by terse internal id (`airgap`, `veil_discord`,
 * `item_cd_burnout`, …). The HUD should NOT show those raw — it should show a
 * readable name, hide pure bookkeeping markers (item-cooldown trackers are already
 * surfaced on the item slots), and colour each chip by whether the effect helps or
 * hurts its bearer.
 *
 * Magnitude vs count: for most effects the engine reuses `stacks` to encode a
 * MAGNITUDE (shield INTEG, slow %, DoT damage, treads bonus) — rendering that as
 * "x300" is misleading, so stack counts are hidden by default and only shown for
 * ids whose stacks are a true count (`showStacks: true`, e.g. Heap Growth).
 * Likewise `permanent: true` marks effects whose tick counter is bookkeeping
 * noise (re-applied every cycle, or a refresh window), so no countdown is shown.
 *
 * Kept pure + framework-free so it is trivially unit-testable and reusable by
 * any HUD surface (Deck, NET, tooltips).
 */

export type BuffKind = 'positive' | 'negative' | 'neutral'

interface BuffMeta {
  label: string
  kind: BuffKind
  /** `stacks` is a true count worth rendering (default: it encodes a magnitude — hide it). */
  showStacks?: boolean
  /** The tick counter is bookkeeping noise (re-applied/refreshed) — never show a countdown. */
  permanent?: boolean
}

// Known effect ids → readable label + intent. Unknown ids fall back to a
// title-cased version of the id and `neutral` colouring (see buffLabel/buffKind).
const BUFF_META: Record<string, BuffMeta> = {
  // ── Defensive / survival (good to have) ──
  airgap: { label: 'AIRGAP', kind: 'positive' },
  breached: { label: 'BREACHED', kind: 'negative' },
  spite_plate: { label: 'Spite Plate', kind: 'positive' },
  ghost_form: { label: 'Ghost Form', kind: 'positive' },
  mirror_shell: { label: 'Mirror Shell', kind: 'positive' },
  firewall_block: { label: 'Ablative Shell', kind: 'positive' },
  shield: { label: 'Shield', kind: 'positive' },
  spellblock: { label: 'Spell Block', kind: 'positive' },
  hardened: { label: 'Hardened', kind: 'positive' },
  backup: { label: 'Backup', kind: 'positive' },
  invulnerable: { label: 'Invulnerable', kind: 'positive' },
  stealth: { label: 'Stealth', kind: 'positive' },
  invis: { label: 'Invisible', kind: 'positive' },
  ghostwire_edge_invis: { label: 'Invisible', kind: 'positive' },
  ghostwire_edge_bonus: { label: 'Crippling Strike', kind: 'positive' },
  smoke: { label: 'Smoke', kind: 'positive' },
  criticalSectionDefense: { label: 'Critical Section', kind: 'positive' },
  deadlock: { label: 'Deadlock', kind: 'positive', showStacks: true, permanent: true },
  defenseBuff: { label: 'Fortify', kind: 'positive' },
  overwatch: { label: 'Overwatch', kind: 'positive', permanent: true },
  phaseShift: { label: 'Phase Shift', kind: 'positive' },
  dmz: { label: 'DMZ', kind: 'positive' },
  // ── Offensive / mobility steroids (good) ──
  allocate: { label: 'Allocate', kind: 'positive' },
  heapGrowth: { label: 'Heap Growth', kind: 'positive', showStacks: true, permanent: true },
  stack_overflow_buff: { label: 'Overclocked', kind: 'positive' },
  kickback_splice_attacks: { label: 'Pike Volley', kind: 'positive' },
  haste: { label: 'Haste', kind: 'positive' },
  dd: { label: 'Double Damage', kind: 'positive' },
  arcane: { label: 'Arcane', kind: 'positive' },
  regen: { label: 'Regen', kind: 'positive' },
  trauma_patch_regen: { label: 'Trauma Patch', kind: 'positive' },
  gait_rig_attack: { label: 'Treads: Attack', kind: 'positive' },
  gait_rig_hp: { label: 'Treads: INTEG', kind: 'positive' },
  gait_rig_mp: { label: 'Treads: BW', kind: 'positive' },
  nextHopShadow: { label: 'Next Hop', kind: 'positive' },
  fullTraceDmg: { label: 'Full Trace', kind: 'positive' },
  hopCount: { label: 'Hop Count', kind: 'positive', showStacks: true },
  feedbackLoop: { label: 'Feedback Loop', kind: 'positive', showStacks: true, permanent: true },
  resonance: { label: 'Resonance', kind: 'positive', showStacks: true, permanent: true },
  cachedEnergy: { label: 'Cached Energy', kind: 'positive', showStacks: true, permanent: true },
  uptimeAtk: { label: 'Uptime', kind: 'positive' },
  uptimeDef: { label: 'Uptime', kind: 'positive' },
  crontabHeal: { label: 'Crontab', kind: 'positive' },
  crontabBw: { label: 'Crontab', kind: 'positive' },
  packetInspection: { label: 'Packet Inspection', kind: 'positive', permanent: true },
  middleman: { label: 'Middleman', kind: 'positive', permanent: true },
  returnMark: { label: 'Return', kind: 'positive' },
  closureActive: { label: 'Closure', kind: 'positive' },
  forkAtk: { label: 'Fork', kind: 'positive' },
  threadPool: { label: 'Thread Pool', kind: 'positive' },
  // ── Vision / utility / mixed (neutral) ──
  dust_reveal: { label: 'Dust', kind: 'neutral' },
  tracepath_vision: { label: 'Trace Vision', kind: 'neutral' },
  tp_channeling: { label: 'Teleporting', kind: 'neutral' },
  cyclone: { label: 'Cyclone', kind: 'neutral' },
  // ── Disables (bad) ──
  stun: { label: 'Stunned', kind: 'negative' },
  silence: { label: 'Silenced', kind: 'negative' },
  root: { label: 'Rooted', kind: 'negative' },
  slow: { label: 'Slowed', kind: 'negative' },
  broadcast_slow: { label: 'Slowed', kind: 'negative' },
  hex: { label: 'Hexed', kind: 'negative' },
  feared: { label: 'Feared', kind: 'negative' },
  taunt: { label: 'Taunted', kind: 'negative' },
  revealed: { label: 'Revealed', kind: 'negative' },
  socket_link: { label: 'Linked', kind: 'negative' },
  attackReduction: { label: 'Timeout', kind: 'negative' },
  latency: { label: 'Latency', kind: 'negative' },
  // ── Damage amplifiers on the bearer (bad) ──
  veil_discord: { label: 'Discord', kind: 'negative' },
  magic_vuln_40: { label: 'Etherealised', kind: 'negative' },
  magicVulnerability: { label: 'Magic Vuln', kind: 'negative' },
  ethereal: { label: 'Ethereal', kind: 'negative' },
  yield: { label: 'Yield', kind: 'negative' },
  mrShred: { label: 'Magic Shred', kind: 'negative' },
  antiHeal: { label: 'Invalidate', kind: 'negative' },
  encryptionKey: { label: 'Encryption Key', kind: 'negative', showStacks: true },
  // ── Damage-over-time (bad) ──
  dot_magical: { label: 'Burning', kind: 'negative' },
  dpi_dot: { label: 'DPI Burn', kind: 'negative' },
  flood_dot: { label: 'Flooded', kind: 'negative' },
  inject_dot: { label: 'Injected', kind: 'negative' },
  voidZone_dot: { label: 'Void Zone', kind: 'negative' },
}

// cyclesRemaining at/above this is a near-permanent aura (e.g. Gait Rig' mode,
// Malloc's Heap Growth) — show it without a misleading "(999t)" countdown.
const PERMANENT_TICKS = 999

/**
 * Internal bookkeeping markers that should never appear in the player's buff strip.
 * `item_cd_*` cooldowns are already shown on the item slots; `tp_destination` is the
 * hidden partner of the visible `tp_channeling`; the rest are engine-side state
 * trackers (target/tick markers, cast counters, combat flags) with no player meaning.
 */
const INTERNAL_BUFF_IDS = new Set([
  'tp_destination',
  'deadlockZone',
  'stealthIdle',
  'patternCacheTarget',
  'patternCacheTick',
  'resonanceTarget',
  'voidDrain',
  'closureCasts',
  'inCombat',
])

export function isInternalBuff(id: string): boolean {
  return id.startsWith('item_cd_') || INTERNAL_BUFF_IDS.has(id)
}

function prettify(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** True when `id` has an authored BUFF_META entry (not just the title-case fallback). */
export function hasBuffMeta(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUFF_META, id)
}

/**
 * Engine-branched buff ids whose presence changes combat resolution (immunity,
 * hard control, reflect, dodge). A missing BUFF_META entry for one of these
 * silently degrades the HUD chip to a title-cased fallback — the guard test
 * in buffs.test.ts fails if any of these lack meta.
 */
export const ENGINE_BRANCHED_BUFF_IDS = [
  'airgap',
  'breached',
  'invulnerable',
  'ethereal',
  'ghost_form',
  'phaseShift',
  'hardened',
  'spite_plate',
  'mirror_shell',
  'spellblock',
  'firewall_block',
  'shield',
  'stun',
  'silence',
  'root',
  'taunt',
  'feared',
  'hex',
  'cyclone',
  'stealth',
  'haste',
  'slow',
  'backup',
] as const

/** Readable label for an effect id (title-cased fallback for unknown ids). */
export function buffLabel(id: string): string {
  return BUFF_META[id]?.label ?? prettify(id)
}

/** Whether an effect helps (`positive`), hurts (`negative`), or is `neutral`. */
export function buffKind(id: string): BuffKind {
  return BUFF_META[id]?.kind ?? 'neutral'
}

export interface DisplayBuff {
  id: string
  label: string
  kind: BuffKind
  /** True stack count when the id opts in via `showStacks`; otherwise 1 (hidden). */
  stacks: number
  /** cyclesRemaining, or null for a near-permanent aura (no countdown shown). */
  ticks: number | null
}

/** Map raw engine buffs to display chips, dropping internal bookkeeping markers. */
export function displayBuffs(
  buffs: { id: string; stacks: number; cyclesRemaining: number }[],
): DisplayBuff[] {
  return buffs
    .filter((b) => !isInternalBuff(b.id))
    .map((b) => {
      const meta = BUFF_META[b.id]
      return {
        id: b.id,
        label: buffLabel(b.id),
        kind: buffKind(b.id),
        stacks: meta?.showStacks ? b.stacks : 1,
        ticks: meta?.permanent || b.cyclesRemaining >= PERMANENT_TICKS ? null : b.cyclesRemaining,
      }
    })
}
