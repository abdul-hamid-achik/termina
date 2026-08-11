import { describe, it, expect } from 'vitest'
import { isAdminIdentity } from '~~/server/utils/admin'

describe('isAdminIdentity (operator panel allow-list)', () => {
  it('denies everyone when both allow-lists are empty', () => {
    expect(isAdminIdentity('github_1', 'abdul@example.com', '', '')).toBe(false)
  })

  it('allows a player id on the id list', () => {
    expect(isAdminIdentity('github_1', null, 'github_1', '')).toBe(true)
    expect(isAdminIdentity('github_2', null, 'github_1', '')).toBe(false)
  })

  it('allows an email on the email list, case-insensitively', () => {
    expect(isAdminIdentity('github_1', 'Abdul@iCloud.com', '', 'abdul@icloud.com')).toBe(true)
    expect(isAdminIdentity('github_1', 'other@icloud.com', '', 'abdul@icloud.com')).toBe(false)
  })

  it('a null email never matches the email list', () => {
    expect(isAdminIdentity('github_1', null, '', 'abdul@icloud.com')).toBe(false)
  })

  it('parses comma-separated lists with whitespace and empty entries', () => {
    expect(isAdminIdentity('p2', null, ' p1 , p2 ,', '')).toBe(true)
    expect(isAdminIdentity('p3', 'a@b.c', ' p1 , p2 ,', ' , A@B.C ')).toBe(true)
  })

  it('an empty-string email in the list can never be satisfied', () => {
    // Blank entries are filtered — an accidental trailing comma must not
    // turn "no email on file" into an admin match.
    expect(isAdminIdentity('p1', null, '', ' , ')).toBe(false)
  })
})
