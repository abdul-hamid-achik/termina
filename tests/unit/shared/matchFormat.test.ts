import { describe, it, expect } from 'vitest'
import { formatGameMode, matchResult, GAME_MODE_LABELS } from '../../../shared/matchFormat'

describe('formatGameMode', () => {
  it('maps every known mode to a friendly label', () => {
    expect(formatGameMode('ranked_5v5')).toBe('Ranked 5v5')
    expect(formatGameMode('quick_3v3')).toBe('Quick 3v3')
    expect(formatGameMode('1v1')).toBe('1v1 Duel')
  })

  it('covers exactly the labelled modes', () => {
    expect(Object.keys(GAME_MODE_LABELS).sort()).toEqual(['1v1', 'quick_3v3', 'ranked_5v5'])
  })

  it('degrades an unknown/legacy mode to underscores-as-spaces (no raw enum leak)', () => {
    expect(formatGameMode('turbo_2v2')).toBe('turbo 2v2')
    expect(formatGameMode('custom')).toBe('custom')
  })
})

describe('matchResult', () => {
  it('is a Victory when the winner is the player team', () => {
    expect(matchResult('radiant', 'radiant')).toBe('Victory')
    expect(matchResult('dire', 'dire')).toBe('Victory')
  })

  it('is a Defeat when the winner is the other team', () => {
    expect(matchResult('radiant', 'dire')).toBe('Defeat')
    expect(matchResult('dire', 'radiant')).toBe('Defeat')
  })

  it('is In Progress when there is no winner yet', () => {
    expect(matchResult(null, 'radiant')).toBe('In Progress')
    expect(matchResult(undefined, 'dire')).toBe('In Progress')
  })

  it('does not guess a result when the player team is unknown', () => {
    expect(matchResult('radiant', null)).toBe('In Progress')
    expect(matchResult('dire', undefined)).toBe('In Progress')
  })
})
