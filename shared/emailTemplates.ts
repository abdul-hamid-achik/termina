/**
 * Transactional email templates. Each builder returns { subject, html, text }.
 * HTML uses inline styles only (email clients strip <style>/external CSS) and a
 * dark terminal look to match the app. Always ship a plain-text part too.
 */

interface Email {
  subject: string
  html: string
  text: string
}

const BG = '#0a0e0a'
const FG = '#c8d6c8'
const DIM = '#7a8a7a'
const RADIANT = '#5ad95a'
const BORDER = '#1e2a1e'

/** Wrap body HTML in the branded shell. `intro` is a short preheader line. */
function shell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${BG};border:1px solid ${BORDER};border-radius:6px;overflow:hidden;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid ${BORDER};">
          <span style="color:${RADIANT};font-size:18px;font-weight:bold;letter-spacing:3px;">&gt;_ TERMINA</span>
        </td></tr>
        <tr><td style="padding:24px;color:${FG};font-size:14px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid ${BORDER};color:${DIM};font-size:11px;line-height:1.5;">
          TERMINA — a text-based MOBA.<br/>
          You received this email because of activity on your Termina account. If this wasn't you, you can ignore it.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="background:${RADIANT};border-radius:4px;">
    <a href="${url}" style="display:inline-block;padding:10px 20px;color:${BG};font-weight:bold;text-decoration:none;font-size:14px;">${label}</a>
  </td></tr></table>`
}

export function verifyEmailTemplate(verifyUrl: string): Email {
  return {
    subject: 'Verify your Termina email',
    html: shell(
      `<p style="margin:0 0 12px;">Welcome to Termina! Confirm this email address to secure your account and enable password recovery.</p>
       ${button('VERIFY EMAIL', verifyUrl)}
       <p style="margin:0;color:${DIM};font-size:12px;">Or paste this link into your browser:<br/>${verifyUrl}</p>
       <p style="margin:12px 0 0;color:${DIM};font-size:12px;">This link expires in 24 hours.</p>`,
    ),
    text: `Welcome to Termina!\n\nConfirm your email to secure your account:\n${verifyUrl}\n\nThis link expires in 24 hours. If this wasn't you, ignore this email.`,
  }
}

export function passwordResetTemplate(resetUrl: string): Email {
  return {
    subject: 'Reset your Termina password',
    html: shell(
      `<p style="margin:0 0 12px;">We received a request to reset your Termina password. Click below to choose a new one.</p>
       ${button('RESET PASSWORD', resetUrl)}
       <p style="margin:0;color:${DIM};font-size:12px;">Or paste this link into your browser:<br/>${resetUrl}</p>
       <p style="margin:12px 0 0;color:${DIM};font-size:12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
    ),
    text: `Reset your Termina password:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email — your password won't change.`,
  }
}

export function passwordChangedTemplate(): Email {
  return {
    subject: 'Your Termina password was changed',
    html: shell(
      `<p style="margin:0 0 12px;">This is a confirmation that the password on your Termina account was just changed.</p>
       <p style="margin:0;color:${DIM};font-size:12px;">If this was you, no action is needed. If you did NOT change your password, reset it immediately and contact support@terminamoba.com.</p>`,
    ),
    text: `Your Termina password was just changed.\n\nIf this was you, no action is needed. If not, reset your password immediately and contact support@terminamoba.com.`,
  }
}

export function welcomeTemplate(username: string): Email {
  return {
    subject: 'Welcome to Termina',
    html: shell(
      `<p style="margin:0 0 12px;">Welcome, <span style="color:${RADIANT};">${username}</span> — your terminal is live.</p>
       <p style="margin:0 0 12px;">Termina is a text-based 5v5 MOBA played through a terminal. Every command is a kill.</p>
       ${button('PLAY NOW', 'https://terminamoba.com/lobby')}
       <p style="margin:0;color:${DIM};font-size:12px;">New here? Try Practice vs Bots from the home screen first.</p>`,
    ),
    text: `Welcome to Termina, ${username}!\n\nTermina is a text-based 5v5 MOBA played through a terminal. Jump in: https://terminamoba.com/lobby`,
  }
}
