import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * GameScreen mounts the death vignette and the game-end flash as full-screen
 * overlays that stay in the DOM for the rest of the match once fired — the
 * animation, not unmounting, is what makes them disappear. Under
 * `prefers-reduced-motion: reduce` terminal.css kills that animation, so the
 * class's own declarations decide what the player is left looking at.
 */
// Anchored on the vitest root (the repo root) — under happy-dom `import.meta.url`
// is an http: URL, so it can't locate the file.
const CSS = readFileSync(resolve(process.cwd(), 'app/assets/css/terminal.css'), 'utf8')

const OVERLAYS = [
  { selector: '.anim-death-vignette', keyframes: 'death-vignette' },
  { selector: '.anim-respawn-vignette', keyframes: 'death-vignette' },
  { selector: '.anim-end-victory', keyframes: 'end-flash' },
  { selector: '.anim-end-defeat', keyframes: 'end-flash' },
] as const

/** The impact flare is `box-shadow`-driven and not `forwards`, so it rests at
 *  the class's own declarations rather than at a held final frame. */
const FLARES = ['.anim-impact', '.anim-impact-strong'] as const

/** Body of the first block whose header matches, brace-matched so nested
    keyframe steps and media-query children come back intact. */
function blockBody(headerPattern: RegExp): string {
  const match = headerPattern.exec(CSS)
  if (!match) throw new Error(`no block matching ${headerPattern} in terminal.css`)
  const open = CSS.indexOf('{', match.index)
  let depth = 0
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(open + 1, i)
  }
  throw new Error(`unterminated block matching ${headerPattern}`)
}

const ruleBody = (selector: string) => blockBody(new RegExp(`\\${selector}\\s*\\{`))

describe('terminal.css one-shot overlays under reduced motion', () => {
  it.each(OVERLAYS)(
    '$selector computes to transparent with no animation running',
    ({ selector }) => {
      const style = document.createElement('style')
      // Injected unlayered: happy-dom drops @layer blocks wholesale, and the
      // cascade layer is irrelevant to the declaration under test.
      style.textContent = `${selector} { ${ruleBody(selector)} }`
      document.head.appendChild(style)

      const el = document.createElement('div')
      el.className = selector.slice(1)
      document.body.appendChild(el)

      // happy-dom never runs animations, which is exactly the reduced-motion
      // situation: whatever the class itself declares is what renders.
      expect(getComputedStyle(el).opacity).toBe('0')

      el.remove()
      style.remove()
    },
  )

  it('suppresses the animation on every one-shot overlay under reduced motion', () => {
    const reduced = blockBody(/@media \(prefers-reduced-motion: reduce\)\s*\{/)
    expect(reduced).toMatch(/animation:\s*none/)
    for (const { selector } of OVERLAYS) {
      expect(reduced).toContain(selector)
    }
    for (const selector of FLARES) {
      expect(reduced).toContain(selector)
    }
  })

  it.each(FLARES)(
    '%s paints nothing of its own, so a suppressed animation leaves a clean screen',
    (selector) => {
      // GameScreen keeps the flare overlay mounted for the rest of the match
      // once the first hit lands — exactly the trap that left a permanent red
      // vignette on screen under reduced motion (bug #9).
      const body = ruleBody(selector)
      expect(body).toMatch(/animation:/)
      expect(body).not.toMatch(/box-shadow|background/)
    },
  )

  it('flares the hit in team red, never a white wash', () => {
    // The old .anim-flash was a 30% WHITE wash: the brightest thing that could
    // appear on a near-black palette, on the most frequent event in the game.
    for (const name of ['flash-damage', 'impact', 'impact-strong']) {
      const frames = blockBody(new RegExp(`@keyframes ${name}\\s*\\{`))
      expect(frames).toContain('--color-audit')
      expect(frames).not.toMatch(/rgb\(\s*255\s+255\s+255/)
    }
  })

  it('scales the hit flash and the light flare with --hit-intensity', () => {
    // A creep chip and a full combo used to paint identically.
    for (const name of ['flash-damage', 'impact']) {
      expect(blockBody(new RegExp(`@keyframes ${name}\\s*\\{`))).toContain('var(--hit-intensity')
    }
  })

  it.each(OVERLAYS)(
    '$selector rests transparent at both ends of $keyframes, so the base opacity cannot alter playback',
    ({ selector, keyframes }) => {
      expect(ruleBody(selector)).toMatch(new RegExp(`animation:\\s*${keyframes}\\b[^;]*forwards`))

      const frames = blockBody(new RegExp(`@keyframes ${keyframes}\\s*\\{`))
      const step = (percent: string) => {
        const found = new RegExp(`(?:^|[\\s{])${percent}\\s*\\{([^}]*)\\}`).exec(frames)
        if (!found) throw new Error(`no ${percent} step in @keyframes ${keyframes}`)
        return found[1]
      }
      expect(step('0%')).toMatch(/opacity:\s*0\s*;/)
      expect(step('100%')).toMatch(/opacity:\s*0\s*;/)
    },
  )
})
