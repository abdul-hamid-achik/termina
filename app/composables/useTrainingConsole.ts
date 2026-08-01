import { ref, reactive, computed, watch } from 'vue'
import type { Ref } from 'vue'
import type { HeroDef } from '~~/shared/types/hero'
import { abilitySummary, abilityImpact, abilityControls } from '~~/shared/abilityFormat'
import { getAbilityBwCost } from '~~/shared/utils/ability'
import {
  getAbilityLevel,
  BASIC_ABILITY_RANKS,
  ULTIMATE_RANKS,
  ULTIMATE_UNLOCK_LEVEL,
} from '~~/shared/constants/balance'

export type ConsoleSlot = 'q' | 'w' | 'e' | 'r'
const SLOTS: ConsoleSlot[] = ['q', 'w', 'e', 'r']

/**
 * Hero levels the console can simulate. Chosen for what each one CHANGES:
 * 1 = no ultimate at all, 6 = the ultimate's first rank, 11 = every basic
 * maxed on a single-rank ultimate, 18 = the full kit. Anything between these
 * moves no gate the console can show.
 */
export const CONSOLE_LEVELS: readonly number[] = [1, ULTIMATE_UNLOCK_LEVEL, 11, 18]

interface ActiveDot {
  source: string
  perTick: number
  ticksLeft: number
}

/** A control/disable currently afflicting the dummy (decays on the scheduler). */
export interface ActiveStatus {
  kind: string
  label: string
  ticksLeft: number
}

const DUMMY_NAME = 'training dummy'

/** First hero level at which a slot is castable at all — the engine's gate. */
function unlockLevelFor(slot: ConsoleSlot): number {
  return (slot === 'r' ? ULTIMATE_RANKS[0] : BASIC_ABILITY_RANKS[0]) ?? 1
}

/** Total ranks a slot can reach, for the "rank 2/4" readout. */
function maxRankFor(slot: ConsoleSlot): number {
  return (slot === 'r' ? ULTIMATE_RANKS : BASIC_ABILITY_RANKS).length
}

/**
 * Max bw at a hero level — mirrors `levelUpHero`, which adds
 * `growthPerLevel.bw` once per level gained. The console used to budget every
 * cast against the level-1 pool, which made a 300-bw ultimate look
 * unaffordable for the whole match.
 */
function maxBwAt(hero: HeroDef, level: number): number {
  return hero.baseStats.bw + (hero.growthPerLevel.bw ?? 0) * Math.max(0, level - 1)
}

/**
 * The /cast training-console state machine: a safe, offline dry-run of a kit
 * (real ability data, cooldowns + bw on the 4s scheduler) resolved against a
 * practice dummy. Extracted from the page so the cast / advance-cycle / DoT /
 * respawn rules are unit-tested — mirroring useLoadout. `hero` and the selected
 * `level` are reactive; changing either resets the console.
 */
export function useTrainingConsole(hero: Ref<HeroDef>, dummyMax = 1000) {
  const level = ref<number>(CONSOLE_LEVELS[0]!)
  const bw = ref(0)
  const cooldowns = reactive<Record<ConsoleSlot, number>>({ q: 0, w: 0, e: 0, r: 0 })
  const cycle = ref(0)
  const log = ref<string[]>([])
  const dummyHp = ref(dummyMax)
  const dots = ref<ActiveDot[]>([])
  // Control effects (stun/slow/silence/…) on the dummy, ticking down live so a
  // learner sees what a kit's disables do and how long they hold.
  const statuses = ref<ActiveStatus[]>([])
  // Running tallies so a learner can compare kits' output at a glance — total
  // damage (burst + resolved DoT ticks) and how many casts it took.
  const totalDamage = ref(0)
  const castCount = ref(0)

  const maxBw = computed(() => maxBwAt(hero.value, level.value))

  /** Rank of a slot at the selected level; 0 = the engine refuses the cast. */
  function rankOf(slot: ConsoleSlot): number {
    return getAbilityLevel(level.value, slot)
  }
  function isLocked(slot: ConsoleSlot): boolean {
    return rankOf(slot) <= 0
  }

  function pushLog(...lines: string[]) {
    log.value.push(...lines)
    if (log.value.length > 50) log.value = log.value.slice(-50)
  }

  function checkDummy() {
    if (dummyHp.value <= 0) {
      dummyHp.value = dummyMax
      dots.value = []
      statuses.value = []
      pushLog(`! ${DUMMY_NAME} destroyed — respawning at full hp`)
    }
  }

  function reset() {
    bw.value = maxBw.value
    for (const s of SLOTS) cooldowns[s] = 0
    cycle.value = 0
    dummyHp.value = dummyMax
    dots.value = []
    statuses.value = []
    totalDamage.value = 0
    castCount.value = 0
    log.value = [
      `>_ ${hero.value.name} at level ${level.value} — click an ability or press Q/W/E/R to cast.`,
    ]
  }

  function cast(slot: ConsoleSlot) {
    const ab = hero.value.abilities[slot]
    if (isLocked(slot)) {
      pushLog(
        `! ${ab.name} not learned yet — ${slot.toUpperCase()} unlocks at level ${unlockLevelFor(slot)}`,
      )
      return
    }
    if (cooldowns[slot] > 0) {
      pushLog(`! ${ab.name} on cooldown (${cooldowns[slot]}c left)`)
      return
    }
    // The console has a level selector, so it must charge what a hero at THAT
    // level actually pays — otherwise it teaches a rotation that is unaffordable
    // in a real match.
    const cost = getAbilityBwCost(ab, slot, level.value)
    if (bw.value < cost) {
      pushLog(`! not enough BW for ${ab.name} (need ${cost}, have ${bw.value})`)
      return
    }
    bw.value -= cost
    cooldowns[slot] = ab.cooldownCycles
    castCount.value++
    pushLog(`> cast ${slot}`, `  ${hero.value.name} casts ${ab.name} — ${abilitySummary(ab)}`)

    // Resolve the ability's impact against the dummy so the player sees it land.
    const impact = abilityImpact(ab)
    if (impact.burst > 0) {
      dummyHp.value = Math.max(0, dummyHp.value - impact.burst)
      totalDamage.value += impact.burst
      pushLog(`  → ${impact.burst} burst dmg  ·  ${DUMMY_NAME} ${dummyHp.value}/${dummyMax}`)
    }
    if (impact.dotPerTick > 0 && impact.dotDuration > 0) {
      dots.value.push({
        source: ab.name,
        perTick: impact.dotPerTick,
        ticksLeft: impact.dotDuration,
      })
      pushLog(
        `  → ${impact.dotPerTick} dmg/c for ${impact.dotDuration}c (advance cycles to resolve)`,
      )
    }
    if (impact.heal > 0) pushLog(`  → heals ${impact.heal} (self/ally)`)
    if (impact.shield > 0) pushLog(`  → grants a ${impact.shield} shield`)

    // Apply control/disable effects to the dummy so disables are visible, not
    // just damage. Re-applying the same control refreshes its duration (the
    // engine doesn't stack identical disables) rather than piling up chips.
    for (const c of abilityControls(ab)) {
      const existing = statuses.value.find((s) => s.kind === c.kind)
      if (existing) {
        existing.ticksLeft = Math.max(existing.ticksLeft, c.duration)
      } else {
        statuses.value.push({ kind: c.kind, label: c.label, ticksLeft: c.duration })
      }
      pushLog(`  → ${c.label} for ${c.duration}c`)
    }
    checkDummy()
  }

  function castable(slot: ConsoleSlot): boolean {
    return (
      !isLocked(slot) &&
      cooldowns[slot] === 0 &&
      bw.value >= getAbilityBwCost(hero.value.abilities[slot], slot, level.value)
    )
  }

  /**
   * Fire the hero's authored opening rotation in one go — every slot in
   * `openingCombo` that is unlocked at the selected level, off cooldown AND
   * affordable (bw depletes as it goes). Following the authored order rather
   * than Q→W→E→R is the point: a learner sees the rotation the hero page
   * teaches, and sees the ultimate silently drop out of it below level 6.
   */
  function castCombo() {
    const rotation = hero.value.openingCombo.length
      ? (hero.value.openingCombo as ConsoleSlot[])
      : SLOTS
    if (!rotation.some(castable)) {
      pushLog('! combo: nothing ready — advance cycles to refresh cooldowns/BW')
      return
    }
    const before = totalDamage.value
    pushLog('> cast COMBO')
    let landed = 0
    for (const s of rotation) {
      if (castable(s)) {
        cast(s)
        landed++
      }
    }
    const dealt = totalDamage.value - before
    pushLog(`  ⇒ combo landed ${landed}: ${dealt} burst dmg this combo (DoTs cycle on advance)`)
  }

  function advanceCycle() {
    cycle.value++
    // Resolve damage-over-time before regen/cooldowns so the dummy drains live.
    if (dots.value.length > 0) {
      let dmg = 0
      for (const d of dots.value) {
        dmg += d.perTick
        d.ticksLeft--
      }
      dots.value = dots.value.filter((d) => d.ticksLeft > 0)
      if (dmg > 0) {
        dummyHp.value = Math.max(0, dummyHp.value - dmg)
        totalDamage.value += dmg
        pushLog(`— dot cycle: −${dmg}  ·  ${DUMMY_NAME} ${dummyHp.value}/${dummyMax}`)
        checkDummy()
      }
    }
    // Decay control effects on the dummy, announcing any that wear off — the
    // learner watches each disable expire on the 4-second clock.
    if (statuses.value.length > 0) {
      for (const s of statuses.value) s.ticksLeft--
      const worn = statuses.value.filter((s) => s.ticksLeft <= 0)
      statuses.value = statuses.value.filter((s) => s.ticksLeft > 0)
      for (const s of worn) pushLog(`— ${s.label} wore off`)
    }
    for (const s of SLOTS) if (cooldowns[s] > 0) cooldowns[s]--
    // A sandbox convenience, NOT a game rule: heroes have no innate BW regen
    // (the fountain and items are the only recovery). Without it the console
    // soft-locks on an empty pool, so it stays — labelled, so nobody learns a
    // regen rate that does not exist.
    const refill = Math.max(2, Math.round(maxBw.value * 0.05))
    bw.value = Math.min(maxBw.value, bw.value + refill)
    pushLog(`— scheduler cycle ${cycle.value}  (+${refill} bw sandbox refill · cooldowns −1)`)
  }

  watch([hero, level], reset, { immediate: true })

  return {
    SLOTS,
    DUMMY_NAME,
    CONSOLE_LEVELS,
    dummyMax,
    level,
    maxBw,
    bw,
    cooldowns,
    cycle,
    log,
    dummyHp,
    dots,
    statuses,
    totalDamage,
    castCount,
    rankOf,
    isLocked,
    maxRankFor,
    unlockLevelFor,
    cast,
    castCombo,
    advanceCycle,
    reset,
  }
}
