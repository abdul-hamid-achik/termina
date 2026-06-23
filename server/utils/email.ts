import { authLog } from '~~/server/utils/log'

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * Send a transactional email via Resend's REST API.
 *
 * BEST-EFFORT BY DESIGN: this never throws and returns a boolean. If no API key
 * is configured (local dev, or before NUXT_RESEND_API_KEY is set in prod) it
 * logs and no-ops. Auth flows treat email as fire-and-forget — a mail outage
 * must never fail a registration, password reset, or password change.
 *
 * Config (server runtimeConfig.resend):
 *   - apiKey     ← NUXT_RESEND_API_KEY (secret)
 *   - from       ← NUXT_RESEND_FROM (e.g. "Termina <noreply@terminamoba.com>"); a
 *                  custom domain must be verified in Resend first. Defaults to
 *                  Resend's shared test sender, which only delivers to the Resend
 *                  account owner — fine for a first smoke test.
 *   - redirectTo ← NUXT_RESEND_REDIRECT_TO. When set, EVERY email is delivered to
 *                  this address instead of the real recipient (the intended
 *                  recipient is preserved in the subject as "[→ user@x]"). A
 *                  staging/testing sink so real users never get test mail; leave
 *                  empty in true production once you're ready to email real users.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const cfg = useRuntimeConfig().resend as
    | { apiKey?: string; from?: string; redirectTo?: string }
    | undefined
  const apiKey = cfg?.apiKey
  const from = cfg?.from || 'Termina <onboarding@resend.dev>'
  const redirectTo = cfg?.redirectTo?.trim()

  if (!apiKey) {
    authLog.warn('Email skipped — NUXT_RESEND_API_KEY not set', {
      to: input.to,
      subject: input.subject,
    })
    return false
  }

  // Redirect override: send to the sink address, but keep the intended recipient
  // visible in the subject so testers can tell who each message was for.
  const to = redirectTo || input.to
  const subject = redirectTo ? `[→ ${input.to}] ${input.subject}` : input.subject
  if (redirectTo) {
    authLog.info('Email redirected to sink', { originalTo: input.to, redirectTo })
  }

  try {
    await $fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { from, to, subject, html: input.html, text: input.text },
    })
    authLog.info('Email sent', { to, originalTo: input.to, subject })
    return true
  } catch (err) {
    // Surface Resend's error body when present (e.g. unverified domain, invalid
    // recipient) so misconfig is debuggable, but never propagate.
    const detail =
      err && typeof err === 'object' && 'data' in err
        ? JSON.stringify((err as { data: unknown }).data)
        : String(err)
    authLog.error('Email send failed', { to: input.to, subject: input.subject, error: detail })
    return false
  }
}
