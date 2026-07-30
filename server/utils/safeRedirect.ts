/**
 * Same-origin path only. Mirrors app/pages/login.vue safeRedirect so OAuth and
 * password login cannot open-redirect after credentials are handled.
 */
export function safeRedirect(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : ''
  if (!value.startsWith('/')) return '/'
  if (value.length > 1 && (value[1] === '/' || value[1] === '\\')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return '/'
  return value
}

export const OAUTH_REDIRECT_COOKIE = 'termina_oauth_redirect'
