import { describe, it, expect } from 'vitest'
import {
  NOTICE_TOPIC_WINDOW,
  dedupeNoticeSentences,
  gateNotice,
  isMilestoneNotice,
  isOrderResponseNotice,
  noticeSpecificity,
  noticeTopic,
} from '~~/app/utils/noticeGate'
import {
  TUTORIAL_FLOW,
  TUTORIAL_IDLE_END_NOTICE,
  tutorialEnrouteNotice,
} from '~~/shared/constants/tutorial'
import { hardenedWalkNote } from '~~/shared/utils/structureRules'

const step = (id: string) => TUTORIAL_FLOW.findIndex((s) => s.id === id)
const cast = TUTORIAL_FLOW[step('cast')]!

describe('dedupeNoticeSentences (playtest 3: two sentences glued into one line)', () => {
  it('drops a sentence that only repeats an order the notice already gave', () => {
    const glued =
      '🎓 A unit in your zone is at 90/400 INTEG — inside the strip window (≤35%). Swing now: `attack wave:0`. A wave unit is in your zone — swing at it: `attack wave:0`.'
    expect(dedupeNoticeSentences(glued)).toBe(
      '🎓 A unit in your zone is at 90/400 INTEG — inside the strip window (≤35%). Swing now: `attack wave:0`.',
    )
  })

  it('keeps sentences that add a new order, and prose without one', () => {
    const t = 'Close it first: `breach daemon`. Then fire: `cast q`. The opening lasts 5 cycles.'
    expect(dedupeNoticeSentences(t)).toBe(t)
  })
})

describe('notice topics and specificity', () => {
  it('in a drill the topic is the drill, so its help / almost / unit lines compete', () => {
    const s = step('cast')
    expect(noticeTopic(cast.help, s)).toBe(noticeTopic(cast.almost!, s))
    expect(noticeTopic('🎓 anything', s)).toBe('step:cast')
  })

  it('order feedback during a drill is not drill coaching (never gated by it)', () => {
    const held =
      'Holding at coldstore-t2-chaff: INTEG 30% — retype `attack ice:coldstore-t1-audit` to push in anyway'
    expect(noticeTopic(held, step('ice'))).not.toBe('step:ice')
  })

  it('outside a drill the topic is the commands named, any wave index alike', () => {
    expect(noticeTopic('Swing: `attack wave:0`')).toBe(noticeTopic('Swing: `attack wave:2`'))
    expect(noticeTopic('Swing: `attack wave:0`')).not.toBe(noticeTopic('`burn wave:0`'))
  })

  it('concrete commands and live readings outrank placeholders', () => {
    expect(noticeSpecificity('`breach <hero>` then `cast q`')).toBeLessThan(
      noticeSpecificity('`breach daemon` then `cast q`'),
    )
    expect(noticeSpecificity('at 90/400 INTEG: `attack wave:0`')).toBeGreaterThan(
      noticeSpecificity('`attack wave:N`'),
    )
  })

  it('a notice answering the player’s own order is recognised from its template (round-4 review)', () => {
    expect(isOrderResponseNotice(cast.almost!.replaceAll('<hero>', 'cron'))).toBe(true)
    expect(
      isOrderResponseNotice(
        `${cast.almostNoFoe!.replaceAll('<hero>', 'cron')} In your zone: cron.`,
      ),
    ).toBe(true)
    expect(isOrderResponseNotice(tutorialEnrouteNotice('coldstore-t3-chaff'))).toBe(true)
    expect(
      isOrderResponseNotice(
        'Holding at coldstore-cross: INTEG 30% — retype `attack ice:x` to push in anyway',
      ),
    ).toBe(true)
    expect(isOrderResponseNotice(hardenedWalkNote(3))).toBe(true)
    // Coaching the player did not ask for is still gated.
    expect(isOrderResponseNotice(cast.help.replaceAll('<hero>', 'cron'))).toBe(false)
    expect(isOrderResponseNotice(cast.done)).toBe(false)
  })

  it('drill done / skipped lines are milestones, never gated', () => {
    expect(isMilestoneNotice(cast.done)).toBe(true)
    expect(isMilestoneNotice(`${cast.done} ${TUTORIAL_FLOW[step('buy')]!.done}`)).toBe(true)
    expect(isMilestoneNotice(`🎓 Moving on — ${cast.skipNote}`)).toBe(true)
    expect(isMilestoneNotice(cast.help)).toBe(false)
    // The practice closing on its idle budget is never folded into a step's coaching.
    expect(isMilestoneNotice(TUTORIAL_IDLE_END_NOTICE)).toBe(true)
  })
})

describe('gateNotice (playtest 3: three cast lines across cycles 127-129)', () => {
  const s = (t: string) => noticeSpecificity(t.replaceAll('<hero>', 'daemon'))

  it('one line per topic: later, no-more-specific notices inside the window drop', () => {
    // (The cast drill's corrections never reach this gate — isOrderResponseNotice.)
    const help = { cycle: 127, specificity: s(cast.help) }
    expect(gateNotice(help, noticeSpecificity(cast.help), 128)).toBe('drop')
    expect(gateNotice(help, s(cast.help), 129)).toBe('drop')
  })

  it('a more specific notice in the SAME cycle replaces the line', () => {
    expect(gateNotice({ cycle: 50, specificity: 2 }, 3, 50)).toBe('replace')
    expect(gateNotice({ cycle: 50, specificity: 2 }, 3, 51)).toBe('show')
  })

  it('prints again once the window has passed', () => {
    const prev = { cycle: 10, specificity: 9 }
    expect(gateNotice(prev, 1, 10 + NOTICE_TOPIC_WINDOW - 1)).toBe('drop')
    expect(gateNotice(prev, 1, 10 + NOTICE_TOPIC_WINDOW)).toBe('show')
    expect(gateNotice(undefined, 0, 3)).toBe('show')
  })
})
