import { describe, it, expect } from 'vitest'
import {
  verifyEmailTemplate,
  passwordResetTemplate,
  passwordChangedTemplate,
  welcomeTemplate,
} from '~~/shared/emailTemplates'

describe('email templates', () => {
  it('verify template embeds the link in both html + text', () => {
    const url = 'https://terminamoba.com/verify-email?token=abc123'
    const t = verifyEmailTemplate(url)
    expect(t.subject.toLowerCase()).toContain('verify')
    expect(t.html).toContain(url)
    expect(t.text).toContain(url)
  })

  it('reset template embeds the link + sets a reset subject', () => {
    const url = 'https://terminamoba.com/reset-password?token=xyz789'
    const t = passwordResetTemplate(url)
    expect(t.subject.toLowerCase()).toContain('reset')
    expect(t.html).toContain(url)
    expect(t.text).toContain(url)
  })

  it('password-changed template has subject + non-empty body', () => {
    const t = passwordChangedTemplate()
    expect(t.subject.toLowerCase()).toContain('password')
    expect(t.html.length).toBeGreaterThan(0)
    expect(t.text.length).toBeGreaterThan(0)
  })

  it('welcome template includes the username', () => {
    const t = welcomeTemplate('neo_radiant')
    expect(t.html).toContain('neo_radiant')
    expect(t.text).toContain('neo_radiant')
  })

  it('all templates produce subject/html/text', () => {
    const all = [
      verifyEmailTemplate('https://x/v'),
      passwordResetTemplate('https://x/r'),
      passwordChangedTemplate(),
      welcomeTemplate('u'),
    ]
    for (const t of all) {
      expect(t.subject).toBeTruthy()
      expect(t.html).toContain('<')
      expect(t.text).toBeTruthy()
    }
  })
})
