/**
 * Player-facing presentation for engine buff/debuff ids.
 *
 * The engine stores effects by terse internal id (`magic_immune`, `veil_discord`,
 * `item_cd_dagon`, …). The HUD should NOT show those raw — it should show a
 * readable name, hide pure bookkeeping markers (item-cooldown trackers are already
 * surfaced on the item slots), and colour each chip by whether the effect helps or
 * hurts its bearer. Kept pure + framework-free so it is trivially unit-testable and
 * reusable by any HUD surface (HeroStatus, War Room, tooltips).
 */

export type BuffKind = 'positive' | 'negative' | 'neutral'

interface BuffMeta {
  label: string
  kind: BuffKind
}

// Known effect ids → readable label + intent. Unknown ids fall back to a
// title-cased version of the id and `neutral` colouring (see buffLabel/buffKind).
const BUFF_META: Record<string, BuffMeta> = {
  // ── Defensive / survival (good to have) ──
  magic_immune: { label: 'Magic Immune', kind: 'positive' },
  blade_mail: { label: 'Blade Mail', kind: 'positive' },
  ghost_form: { label: 'Ghost Form', kind: 'positive' },
  lotus_orb: { label: 'Lotus Orb', kind: 'positive' },
  firewall_block: { label: 'Firewall', kind: 'positive' },
  shield: { label: 'Shield', kind: 'positive' },
  spellblock: { label: 'Spell Block', kind: 'positive' },
  hardened: { label: 'Hardened', kind: 'positive' },
  aegis: { label: 'Aegis', kind: 'positive' },
  invulnerable: { label: 'Invulnerable', kind: 'positive' },
  stealth: { label: 'Stealth', kind: 'positive' },
  invis: { label: 'Invisible', kind: 'positive' },
  silver_edge_invis: { label: 'Invisible', kind: 'positive' },
  silver_edge_bonus: { label: 'Crippling Strike', kind: 'positive' },
  smoke: { label: 'Smoke', kind: 'positive' },
  // ── Offensive / mobility steroids (good) ──
  allocate: { label: 'Allocate', kind: 'positive' },
  stack_overflow_buff: { label: 'Overclocked', kind: 'positive' },
  hurricane_pike_attacks: { label: 'Pike Volley', kind: 'positive' },
  haste: { label: 'Haste', kind: 'positive' },
  dd: { label: 'Double Damage', kind: 'positive' },
  arcane: { label: 'Arcane', kind: 'positive' },
  regen: { label: 'Regen', kind: 'positive' },
  healing_salve_regen: { label: 'Healing Salve', kind: 'positive' },
  power_treads_attack: { label: 'Treads: Attack', kind: 'positive' },
  power_treads_hp: { label: 'Treads: HP', kind: 'positive' },
  power_treads_mp: { label: 'Treads: MP', kind: 'positive' },
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
  deadlock: { label: 'Deadlocked', kind: 'negative' },
  revealed: { label: 'Revealed', kind: 'negative' },
  socket_link: { label: 'Linked', kind: 'negative' },
  // ── Damage amplifiers on the bearer (bad) ──
  veil_discord: { label: 'Discord', kind: 'negative' },
  magic_vuln_40: { label: 'Etherealised', kind: 'negative' },
  ethereal: { label: 'Ethereal', kind: 'negative' },
  yield: { label: 'Yield', kind: 'negative' },
  // ── Damage-over-time (bad) ──
  dot_magical: { label: 'Burning', kind: 'negative' },
  dpi_dot: { label: 'DPI Burn', kind: 'negative' },
  flood_dot: { label: 'Flooded', kind: 'negative' },
  inject_dot: { label: 'Injected', kind: 'negative' },
  dmz: { label: 'DMZ', kind: 'negative' },
}

// ticksRemaining at/above this is a near-permanent aura (e.g. Power Treads' mode,
// Malloc's Heap Growth) — show it without a misleading "(999t)" countdown.
const PERMANENT_TICKS = 999

/**
 * Internal bookkeeping markers that should never appear in the player's buff strip.
 * `item_cd_*` cooldowns are already shown on the item slots; `tp_destination` is the
 * hidden partner of the visible `tp_channeling`.
 */
export function isInternalBuff(id: string): boolean {
  return id.startsWith('item_cd_') || id === 'tp_destination'
}

function prettify(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

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
  stacks: number
  /** ticksRemaining, or null for a near-permanent aura (no countdown shown). */
  ticks: number | null
}

/** Map raw engine buffs to display chips, dropping internal bookkeeping markers. */
export function displayBuffs(
  buffs: { id: string; stacks: number; ticksRemaining: number }[],
): DisplayBuff[] {
  return buffs
    .filter((b) => !isInternalBuff(b.id))
    .map((b) => ({
      id: b.id,
      label: buffLabel(b.id),
      kind: buffKind(b.id),
      stacks: b.stacks,
      ticks: b.ticksRemaining >= PERMANENT_TICKS ? null : b.ticksRemaining,
    }))
}
