import {
  TUTORIAL_FLOW,
  TUTORIAL_IDLE_END_NOTICE,
  tutorialEnrouteNotice,
} from '~~/shared/constants/tutorial'
import { hardenedWalkNote } from '~~/shared/utils/structureRules'

/**
 * Coaching notices (the server's `info` announcements — tutorial 🎓 lines,
 * walk notes) are gated before they reach the STREAM, so one piece of advice
 * prints once:
 *
 * - inside a notice, a sentence that only repeats a command an earlier sentence
 *   already gave is dropped ("…Swing now: `attack wave:0`. A wave unit is in
 *   your zone — swing at it: `attack wave:0`." — playtest 3);
 * - per TOPIC (the tutorial step, else the commands a notice names), only the
 *   most specific notice is kept within NOTICE_TOPIC_WINDOW cycles — the cast
 *   step printed three lines for one combo across cycles 127-129.
 *
 * Milestones — a drill done, a "Moving on" skip — always print, and so does a
 * notice that ANSWERS the player's own order (isOrderResponseNotice): the cast
 * drill's correction scored below the step's opening help and was dropped
 * inside the window, leaving a wrong cast unexplained (round-4 review). Pure.
 */

/** Cycles within which a notice on the same topic must ADD something to print. */
export const NOTICE_TOPIC_WINDOW = 4

export interface NoticeRecord {
  cycle: number
  specificity: number
}

export type NoticeVerdict = 'show' | 'replace' | 'drop'

const COMMAND = /`([^`]+)`/g

/** The backticked commands a notice names, with `wave:N` / `neutral:N`
 *  indices folded (the same advice at another index is the same advice). */
export function noticeCommands(text: string): string[] {
  return [...text.matchAll(COMMAND)].map((m) =>
    m[1]!
      .trim()
      .toLowerCase()
      .replace(/\b(wave|neutral):\d+\b/g, '$1:N'),
  )
}

/**
 * How much a notice tells the player to DO, concretely: each command counts,
 * one with no `<placeholder>` left in it counts double, and a live reading
 * ("at 90/400 INTEG") adds one — it is about this moment, not the drill.
 */
export function noticeSpecificity(text: string): number {
  let score = 0
  for (const m of text.matchAll(COMMAND)) score += m[1]!.includes('<') ? 1 : 2
  if (/\b\d+\/\d+\b/.test(text)) score += 1
  return score
}

/** Drop a sentence whose commands an earlier sentence of the same notice already gave. */
export function dedupeNoticeSentences(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=\S)/)
  if (sentences.length < 2) return text
  const given = new Set<string>()
  const kept: string[] = []
  for (const sentence of sentences) {
    const cmds = noticeCommands(sentence)
    if (cmds.length > 0 && cmds.every((c) => given.has(c))) continue
    for (const c of cmds) given.add(c)
    kept.push(sentence)
  }
  return kept.join(' ')
}

/** A drill completed or skipped — news, never folded into coaching. */
export function isMilestoneNotice(text: string): boolean {
  if (text.startsWith('🎓 Moving on')) return true
  // The practice closing on its idle budget is news, whatever the step said.
  if (text === TUTORIAL_IDLE_END_NOTICE) return true
  return TUTORIAL_FLOW.some((s) => text.startsWith(s.done))
}

/** How the server's held-walk notice begins (ActionResolver.approachHold). */
export const WALK_HELD_PREFIX = 'Holding at '

/** The fixed opening of a templated notice: everything before its first
 *  placeholder / interpolated command. */
const templateHead = (text: string): string => text.split(/<|`/)[0]!

/** Openings of the notices that answer an order the player just gave. */
const ORDER_RESPONSE_HEADS: readonly string[] = [
  WALK_HELD_PREFIX,
  templateHead(tutorialEnrouteNotice('')),
  // The walk an `attack ice:` from range starts toward a Hardened ICE.
  hardenedWalkNote(0).split(' — ')[0]!,
  ...TUTORIAL_FLOW.flatMap((s) => [s.almost, s.almostNoFoe])
    .filter((t): t is string => !!t)
    .map((t) => t.split('<')[0]!),
]

/**
 * A notice that responds to the player's OWN order — the cast drill's
 * correction ("That cast met a CLOSED hero … `breach X` first", "Cast fired —
 * now the combo …"), the held walk, the en-route note. The server sends each
 * once per order, so it is never folded into the drill's coaching nor
 * swallowed by the repeat window: a correction the player never sees is a
 * wrong order left unexplained.
 */
export function isOrderResponseNotice(text: string): boolean {
  return ORDER_RESPONSE_HEADS.some((head) => head.length > 0 && text.startsWith(head))
}

/** What a notice is about: for drill coaching (🎓) while a drill runs, the
 *  drill; anything else — order feedback such as a held walk — by the commands
 *  it names (a notice naming none is its own topic), so it never competes with
 *  the coaching. */
export function noticeTopic(text: string, tutorialStep?: number): string {
  if (tutorialStep !== undefined && TUTORIAL_FLOW[tutorialStep] && text.startsWith('🎓')) {
    return `step:${TUTORIAL_FLOW[tutorialStep]!.id}`
  }
  const cmds = noticeCommands(text)
  return cmds.length > 0 ? `cmd:${[...new Set(cmds)].sort().join('|')}` : `text:${text}`
}

/**
 * Print, swap into the topic's line from this same cycle, or drop. Inside the
 * window a notice prints only when it is MORE specific than the topic's last
 * one; in the same cycle it replaces that line instead of adding a second.
 */
export function gateNotice(
  prev: NoticeRecord | undefined,
  specificity: number,
  cycle: number,
): NoticeVerdict {
  if (!prev || cycle - prev.cycle >= NOTICE_TOPIC_WINDOW) return 'show'
  if (specificity <= prev.specificity) return 'drop'
  return cycle === prev.cycle ? 'replace' : 'show'
}
