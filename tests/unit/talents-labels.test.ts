import { describe, it, expect } from 'vitest'
import { TALENT_TREES, type Talent } from '~~/shared/constants/talents'
import { HEROES } from '~~/shared/constants/heroes'
import { DOUBLE_CAST_CHANCE, SPELL_LIFESTEAL_PERCENT } from '~~/shared/constants/balance'

/**
 * Talent labels must say what the engine does. The engine (applyAbilityTalents in
 * server/game/heroes/_base.ts) applies:
 *  - cooldownReduction in CYCLES (1 cycle = 4 s), floor 1 — never seconds.
 *  - damageBoost as an extra N% of the INTEG each enemy actually LOST to that
 *    cast (post-mitigation), not as a "+N% damage" stat.
 *  - bwCostReduction as a refund of N% of the BW the cast spent.
 * Every assertion reads the registries (HEROES / TALENT_TREES), never a copied
 * label string, so renaming a hero ability makes a stale talent fail here.
 */

type Slot = 'q' | 'w' | 'e' | 'r'
const SLOTS: Slot[] = ['q', 'w', 'e', 'r']

const ALL: Array<{ heroId: string; t: Talent }> = Object.entries(TALENT_TREES).flatMap(
  ([heroId, tree]) => Object.values(tree.tiers).flatMap((pair) => pair.map((t) => ({ heroId, t }))),
)

/** Names a hero's own talents may refer to: its four abilities + its passive. */
function ownNames(heroId: string): string[] {
  const hero = HEROES[heroId]!
  return [hero.passive.name, ...SLOTS.map((s) => hero.abilities[s].name)]
}

function abilityOf(heroId: string, t: Talent) {
  return HEROES[heroId]!.abilities[t.abilityId as Slot]
}

const text = (t: Talent) => `${t.name} ${t.description}`

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('talent registry coverage', () => {
  it('has a tree for every hero in the registry (and 8 talents each)', () => {
    for (const heroId of Object.keys(HEROES)) {
      expect(TALENT_TREES[heroId as keyof typeof TALENT_TREES], heroId).toBeDefined()
    }
    expect(ALL.length).toBe(Object.keys(HEROES).length * 8)
  })
})

describe('A. cooldownReduction is labelled in cycles, never seconds', () => {
  const cd = ALL.filter(({ t }) => t.cooldownReduction !== undefined)

  it('exists for a healthy number of talents (guards against a vacuous loop)', () => {
    expect(cd.length).toBeGreaterThan(30)
  })

  it.each(cd.map(({ heroId, t }) => [t.id, heroId, t] as const))(
    '%s names its reduction in cycles with the right number',
    (_id, heroId, t) => {
      const n = t.cooldownReduction!
      const unit = n === 1 ? 'cycle' : 'cycles'
      const want = new RegExp(`\\b${n} ${unit}\\b`, 'i')
      expect(t.name, 'name').toMatch(want)
      expect(t.description, 'description').toMatch(want)
      // Any "<number> cycle(s)" it mentions must be THE number.
      for (const m of text(t).matchAll(/(\d+)\s*cycles?\b/gi)) {
        expect(Number(m[1]), `${t.id}: ${m[0]}`).toBe(n)
      }
      // Never claims seconds: "-2s", "2 seconds", "2 sec", "s CD".
      expect(text(t)).not.toMatch(/\d\s?s\b/i)
      expect(text(t)).not.toMatch(/\bsec(ond)?s?\b/i)
      expect(text(t)).not.toMatch(/\bs CD\b/)
      // And it names the ability it actually shortens.
      const ability = abilityOf(heroId, t)
      expect(t.name).toContain(ability.name)
      expect(t.description).toContain(ability.name)
    },
  )

  it('never promises more cycles off than the ability can lose (floor is 1 cycle)', () => {
    for (const { heroId, t } of cd) {
      const ability = abilityOf(heroId, t)
      expect(
        t.cooldownReduction!,
        `${t.id} cuts ${t.cooldownReduction} off a ${ability.cooldownCycles}-cycle cooldown`,
      ).toBeLessThan(ability.cooldownCycles)
    }
  })
})

describe('B. damageBoost is labelled as extra INTEG removed, not "% damage"', () => {
  const boosts = ALL.filter(({ t }) => t.damageBoost !== undefined)

  it('exists for a healthy number of talents', () => {
    expect(boosts.length).toBeGreaterThan(15)
  })

  it.each(boosts.map(({ heroId, t }) => [t.id, heroId, t] as const))(
    '%s says it removes N% more INTEG from each enemy it hits',
    (_id, heroId, t) => {
      const n = t.damageBoost!
      expect(t.name).toContain(`${n}%`)
      expect(t.description).toContain(`${n}%`)
      // The engine adds N% of the INTEG LOST, so the label is about INTEG.
      expect(t.name).toMatch(/INTEG/)
      expect(t.description).toMatch(/INTEG/)
      expect(t.description).toMatch(/more/i)
      expect(t.description).toMatch(/enem/i)
      // No bare "+N% Damage" stat framing in the name.
      expect(t.name).not.toMatch(/\bDamage\b/i)
      const ability = abilityOf(heroId, t)
      expect(t.name).toContain(ability.name)
      expect(t.description).toContain(ability.name)
    },
  )
})

describe('bwCostReduction is labelled as the refund the engine pays', () => {
  const bw = ALL.filter(({ t }) => t.bwCostReduction !== undefined)
  it.each(bw.map(({ heroId, t }) => [t.id, heroId, t] as const))(
    '%s states its percentage and names its ability',
    (_id, heroId, t) => {
      expect(text(t)).toContain(`${t.bwCostReduction}%`)
      const ability = abilityOf(heroId, t)
      expect(t.name).toContain(ability.name)
      expect(t.description).toContain(ability.name)
      expect(text(t)).toMatch(/BW/)
    },
  )
})

describe('C. every ability-targeted talent matches a real ability of its hero', () => {
  const targeted = ALL.filter(({ t }) => t.abilityId !== undefined)

  it('abilityId is one of q/w/e/r', () => {
    for (const { t } of targeted) expect(SLOTS, t.id).toContain(t.abilityId)
  })

  it('every "(Q)"-style slot token in the text is the talent\'s own slot, preceded by that ability\'s name', () => {
    for (const { heroId, t } of ALL) {
      for (const m of t.description.matchAll(/\(([QWER])\)/g)) {
        const slot = m[1]!.toLowerCase() as Slot
        expect(t.abilityId, `${t.id} mentions (${m[1]}) but targets ${t.abilityId}`).toBe(slot)
        const name = HEROES[heroId]!.abilities[slot].name
        expect(t.description, `${t.id}: "${name} (${m[1]})"`).toContain(`${name} (${m[1]})`)
      }
    }
  })

  it('never mentions another hero\'s ability or passive name (e.g. the old "Echo Stun")', () => {
    const owners = new Map<string, Set<string>>()
    for (const [id, hero] of Object.entries(HEROES)) {
      for (const n of [hero.passive.name, ...SLOTS.map((s) => hero.abilities[s].name)]) {
        if (!owners.has(n)) owners.set(n, new Set())
        owners.get(n)!.add(id)
      }
    }
    const bad: string[] = []
    for (const { heroId, t } of ALL) {
      const mine = new Set(ownNames(heroId))
      // Strip this hero's own (possibly multi-word) names first, so "Fork Bomb"
      // does not read as thread's "Fork".
      let remaining = text(t)
      for (const own of [...mine].sort((a, b) => b.length - a.length)) {
        remaining = remaining.split(own).join(' ')
      }
      for (const [n, heroes] of owners) {
        if (mine.has(n) || heroes.has(heroId)) continue
        // Case-sensitive, whole-word: ability names are proper nouns.
        if (new RegExp(`\\b${escapeRe(n)}\\b`).test(remaining)) {
          bad.push(`${t.id} mentions "${n}" which belongs to ${[...heroes].join('/')}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('a talent that targets a slot never talks about a DIFFERENT slot of the same hero', () => {
    for (const { heroId, t } of targeted) {
      const own = abilityOf(heroId, t).name
      for (const s of SLOTS) {
        if (s === t.abilityId) continue
        const other = HEROES[heroId]!.abilities[s].name
        if (other === own) continue // e.g. a name shared with the passive
        expect(text(t), `${t.id} (${t.abilityId}) talks about ${s}: ${other}`).not.toMatch(
          new RegExp(`\\b${escapeRe(other)}\\b`),
        )
      }
    }
  })

  it('exotic cast effects quote the real balance constants', () => {
    for (const { t } of ALL) {
      if (t.castEffect === 'double_cast') {
        expect(t.description).toContain(`${Math.round(DOUBLE_CAST_CHANCE * 100)}%`)
        expect(t.specialEffect ?? '').toContain(`${Math.round(DOUBLE_CAST_CHANCE * 100)}%`)
      }
      if (t.castEffect === 'spell_lifesteal') {
        expect(t.description).toContain(`${Math.round(SPELL_LIFESTEAL_PERCENT * 100)}%`)
      }
    }
  })

  describe('echo (its old talents named abilities that do not exist)', () => {
    const echo = Object.values(TALENT_TREES.echo.tiers).flat()
    const names = SLOTS.map((s) => HEROES.echo!.abilities[s].name)

    it("every ability-targeted echo talent names that slot's real ability", () => {
      for (const t of echo) {
        if (!t.abilityId) continue
        expect(text(t), t.id).toContain(HEROES.echo!.abilities[t.abilityId].name)
      }
    })

    it('echo text only ever uses real Echo ability names', () => {
      for (const t of echo) {
        expect(text(t), t.id).not.toMatch(/Echo (Stun|Location|Streak|Damage)/)
        expect(text(t), t.id).not.toMatch(/Double Echo/)
      }
      expect(names).toEqual(['Resonance', 'Phase Shift', 'Feedback Loop', 'Cascade'])
    })
  })
})

describe('D. no placeholder talents', () => {
  it('every talent has a name that differs from its description', () => {
    for (const { t } of ALL) {
      expect(t.description.trim().toLowerCase(), `${t.id} name === description`).not.toBe(
        t.name.trim().toLowerCase(),
      )
    }
  })

  it('no generic placeholder names ("Defense Boost" style)', () => {
    for (const { t } of ALL) {
      expect(t.name, t.id).not.toMatch(/\b(Boost|Defense|Iceance)\b/i)
      expect(t.description, t.id).not.toMatch(/\b(Defense|Iceance)\b/i)
    }
  })

  it('a stat talent says which stat in the lexicon (ICE / PLATE / INTEG / BW / Attack) and adds context', () => {
    for (const { t } of ALL) {
      if (!t.statBonus) continue
      const word = {
        integ: /INTEG/i,
        bw: /BW/i,
        attack: /Attack/i,
        plate: /Plate/i,
        ice: /ICE/i,
        attackSpeed: /Attack Speed/i,
      }[t.statBonus.stat]
      expect(t.name, `${t.id} name`).toMatch(word)
      expect(t.description, `${t.id} description`).toMatch(word)
      expect(text(t), t.id).toContain(String(t.statBonus.value))
      expect(t.description.length, `${t.id} description adds nothing`).toBeGreaterThan(
        t.name.length,
      )
    }
  })

  it('kernel / regex / firewall / proxy stat talents describe their hero, not just a number', () => {
    for (const heroId of ['kernel', 'regex', 'firewall', 'proxy'] as const) {
      for (const pair of Object.values(TALENT_TREES[heroId].tiers)) {
        for (const t of pair) {
          if (!t.statBonus) continue
          // Strip the number + stat words: something hero-specific must remain.
          const rest = t.description
            .replace(/[+\-\d%]+/g, '')
            .replace(/\b(max(imum)?|INTEG|BW|ICE|Plate|Attack|Increases?|by|Damage)\b/gi, '')
            .replace(/[\s—\-.,]+/g, ' ')
            .trim()
          expect(rest.length, `${t.id}: "${t.description}"`).toBeGreaterThan(8)
        }
      }
    }
  })
})

describe('player-facing lexicon in talent text', () => {
  const BANNED = /\b(tower|roshan|aegis|rune|glyph|deny|creep|jungle|gold|mana|ticks?)s?\b/i
  it('has no old-world words and never says "tick" (the player word is cycle)', () => {
    for (const { t } of ALL) {
      expect(text(t), t.id).not.toMatch(BANNED)
      expect(t.specialEffect ?? '', t.id).not.toMatch(BANNED)
    }
  })
})
