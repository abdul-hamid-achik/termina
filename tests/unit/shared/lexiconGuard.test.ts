import { describe, it, expect } from 'vitest'
import { HEROES } from '~~/shared/constants/heroes'
import { TALENT_TREES } from '~~/server/game/heroes/index'
import { ITEMS } from '~~/shared/constants/items'
import { TUTORIAL_FLOW } from '~~/shared/constants/tutorial'
import { POSTURE_META } from '~~/shared/constants/postures'

/**
 * The lexicon guard (R1-23's real deliverable): the OLD world vocabulary may
 * never appear in an authored, player-facing string again. An identifier can
 * change hands any release; this test is what stops the prose drifting back
 * to towers and Roshan the next time someone adds a hero or an item.
 *
 * The list is deliberately whole-word and case-insensitive. `siege` survives
 * only inside the item name "Siege Lattice" (an ALLOWED proper name until
 * that item is renamed — see the rename manifest).
 */
const BANNED = [
  'tower',
  'roshan',
  'aegis',
  'rune',
  'glyph',
  'deny',
  'creep',
  'jungle',
  'gold', // currency is scrip — prose must not say scrip
  'radiant',
  'dire',
  'melee',
  'ranged',
  'mana', // resource is BW
  'mainframe', // structure is Terminal
] as const

const BANNED_RE = new RegExp(`\\b(${BANNED.join('|')})s?\\b`, 'i')

function* authoredStrings(): Generator<[string, string]> {
  for (const hero of Object.values(HEROES)) {
    yield [`hero ${hero.id} lore`, hero.lore]
    yield [`hero ${hero.id} oneLineTip`, hero.oneLineTip]
    yield [`hero ${hero.id} passive "${hero.passive.name}"`, hero.passive.description]
    for (const slot of ['q', 'w', 'e', 'r'] as const) {
      const ab = hero.abilities[slot]
      yield [`hero ${hero.id} ${slot.toUpperCase()} "${ab.name}"`, ab.description]
    }
  }
  for (const [heroId, tree] of Object.entries(TALENT_TREES)) {
    for (const [tier, sides] of Object.entries(tree.tiers)) {
      for (const side of ['left', 'right'] as const) {
        for (const t of sides[side] ?? []) {
          yield [`talent ${heroId} t${tier} ${side} "${t.name}"`, t.description]
        }
      }
    }
  }
  for (const item of Object.values(ITEMS)) {
    if (item.active) yield [`item ${item.id} active "${item.active.name}"`, item.active.description]
    if (item.passive)
      yield [`item ${item.id} passive "${item.passive.name}"`, item.passive.description]
  }
  for (const step of TUTORIAL_FLOW) {
    yield [`tutorial ${step.teaches} hint`, step.hint]
    yield [`tutorial ${step.teaches} skipNote`, step.skipNote]
  }
  for (const [posture, meta] of Object.entries(POSTURE_META)) {
    yield [`posture ${posture} blurb`, meta.blurb]
  }
}

describe('the lexicon guard — the old world may not come back', () => {
  it('no authored string contains a banned word', () => {
    const hits: string[] = []
    for (const [where, text] of authoredStrings()) {
      const m = BANNED_RE.exec(text)
      if (m) hits.push(`${where}: "${m[0]}" in ${JSON.stringify(text.slice(0, 90))}`)
    }
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('siege survives only as the item proper name (Siege Lattice)', () => {
    // `siege` is not in BANNED above for this one name — assert the fence
    // stays exactly one item wide and does not widen silently.
    const siegeNamed = Object.values(ITEMS).filter((i) => /\bsiege\b/i.test(i.name))
    expect(siegeNamed.map((i) => i.id)).toEqual(['siege_lattice'])
  })
})
