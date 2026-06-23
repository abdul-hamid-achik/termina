import { ref, reactive, watch } from 'vue'
import type { Ref } from 'vue'
import type { HeroDef } from '~~/shared/types/hero'
import { abilitySummary, abilityImpact } from '~~/shared/abilityFormat'

export type ConsoleSlot = 'q' | 'w' | 'e' | 'r'
const SLOTS: ConsoleSlot[] = ['q', 'w', 'e', 'r']

interface ActiveDot {
  source: string
  perTick: number
  ticksLeft: number
}

const DUMMY_NAME = 'training dummy'

/**
 * The /heroes training-console state machine: a safe, offline dry-run of a kit
 * (real ability data, cooldowns + mana on the 4s scheduler) resolved against a
 * practice dummy. Extracted from the page so the cast / advance-tick / DoT /
 * respawn rules are unit-tested — mirroring useLoadout. `hero` is reactive;
 * changing it resets the console.
 */
export function useTrainingConsole(hero: Ref<HeroDef>, dummyMax = 1000) {
  const mana = ref(0)
  const cooldowns = reactive<Record<ConsoleSlot, number>>({ q: 0, w: 0, e: 0, r: 0 })
  const tick = ref(0)
  const log = ref<string[]>([])
  const dummyHp = ref(dummyMax)
  const dots = ref<ActiveDot[]>([])
  // Running tallies so a learner can compare kits' output at a glance — total
  // damage (burst + resolved DoT ticks) and how many casts it took.
  const totalDamage = ref(0)
  const castCount = ref(0)

  function pushLog(...lines: string[]) {
    log.value.push(...lines)
    if (log.value.length > 50) log.value = log.value.slice(-50)
  }

  function checkDummy() {
    if (dummyHp.value <= 0) {
      dummyHp.value = dummyMax
      dots.value = []
      pushLog(`! ${DUMMY_NAME} destroyed — respawning at full hp`)
    }
  }

  function reset() {
    mana.value = hero.value.baseStats.mp
    for (const s of SLOTS) cooldowns[s] = 0
    tick.value = 0
    dummyHp.value = dummyMax
    dots.value = []
    totalDamage.value = 0
    castCount.value = 0
    log.value = [`>_ ${hero.value.name} loaded — click an ability or press Q/W/E/R to cast.`]
  }

  function cast(slot: ConsoleSlot) {
    const ab = hero.value.abilities[slot]
    if (cooldowns[slot] > 0) {
      pushLog(`! ${ab.name} on cooldown (${cooldowns[slot]}t left)`)
      return
    }
    if (mana.value < ab.manaCost) {
      pushLog(`! not enough mana for ${ab.name} (need ${ab.manaCost}, have ${mana.value})`)
      return
    }
    mana.value -= ab.manaCost
    cooldowns[slot] = ab.cooldownTicks
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
        `  → ${impact.dotPerTick} dmg/t for ${impact.dotDuration}t (advance ticks to resolve)`,
      )
    }
    if (impact.heal > 0) pushLog(`  → heals ${impact.heal} (self/ally)`)
    if (impact.shield > 0) pushLog(`  → grants a ${impact.shield} shield`)
    checkDummy()
  }

  /**
   * Fire the hero's full opening rotation in one go — every ability that is off
   * cooldown AND affordable, cast in Q→W→E→R order (mana depletes as it goes).
   * Lets a learner see a kit's burst combo without hand-casting each slot.
   */
  function castCombo() {
    const anyReady = SLOTS.some(
      (s) => cooldowns[s] === 0 && mana.value >= hero.value.abilities[s].manaCost,
    )
    if (!anyReady) {
      pushLog('! combo: nothing ready — advance ticks to refresh cooldowns/mana')
      return
    }
    const before = totalDamage.value
    pushLog('> cast COMBO')
    let landed = 0
    for (const s of SLOTS) {
      if (cooldowns[s] === 0 && mana.value >= hero.value.abilities[s].manaCost) {
        cast(s)
        landed++
      }
    }
    const dealt = totalDamage.value - before
    pushLog(`  ⇒ combo landed ${landed}: ${dealt} burst dmg this combo (DoTs tick on advance)`)
  }

  function advanceTick() {
    tick.value++
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
        pushLog(`— dot tick: −${dmg}  ·  ${DUMMY_NAME} ${dummyHp.value}/${dummyMax}`)
        checkDummy()
      }
    }
    for (const s of SLOTS) if (cooldowns[s] > 0) cooldowns[s]--
    const regen = Math.max(2, Math.round(hero.value.baseStats.mp * 0.05))
    mana.value = Math.min(hero.value.baseStats.mp, mana.value + regen)
    pushLog(`— scheduler tick ${tick.value}  (+${regen} mp · cooldowns −1)`)
  }

  watch(hero, reset, { immediate: true })

  return {
    SLOTS,
    DUMMY_NAME,
    dummyMax,
    mana,
    cooldowns,
    tick,
    log,
    dummyHp,
    dots,
    totalDamage,
    castCount,
    cast,
    castCombo,
    advanceTick,
    reset,
  }
}
