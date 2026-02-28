import type { Page } from '@playwright/test'

/**
 * Install a WebSocket message interceptor on the page.
 * Must be called before navigating to a page that opens a WebSocket.
 */
export async function installWsInterceptor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const messages: Array<{ direction: 'sent' | 'received'; data: string; timestamp: number }> = []

    const OriginalWebSocket = window.WebSocket

    // @ts-expect-error — overriding WebSocket constructor
    window.WebSocket = function (url: string, protocols?: string | string[]) {
      const ws = new OriginalWebSocket(url, protocols)

      const origSend = ws.send.bind(ws)
      ws.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        messages.push({
          direction: 'sent',
          data: typeof data === 'string' ? data : '[binary]',
          timestamp: Date.now(),
        })
        return origSend(data)
      }

      ws.addEventListener('message', (event: MessageEvent) => {
        messages.push({
          direction: 'received',
          data: typeof event.data === 'string' ? event.data : '[binary]',
          timestamp: Date.now(),
        })
      })

      return ws
    } as unknown as typeof WebSocket

    // Preserve prototype chain
    ;(window.WebSocket as unknown as { prototype: WebSocket }).prototype =
      OriginalWebSocket.prototype
    ;(window as unknown as Record<string, unknown>).__e2eWsMessages = messages
  })
}

/**
 * Retrieve captured WebSocket messages from the page.
 */
async function getCapturedWsMessages(
  page: Page,
): Promise<Array<{ direction: 'sent' | 'received'; data: string; timestamp: number }>> {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__e2eWsMessages as Array<{
        direction: 'sent' | 'received'
        data: string
        timestamp: number
      }> ?? [],
  )
}

/**
 * Get parsed JSON WebSocket messages filtered by direction and optional type.
 */
export async function getWsJsonMessages(
  page: Page,
  direction: 'sent' | 'received',
  type?: string,
): Promise<Record<string, unknown>[]> {
  const messages = await getCapturedWsMessages(page)
  return messages
    .filter((m) => m.direction === direction)
    .map((m) => {
      try {
        return JSON.parse(m.data) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter((m): m is Record<string, unknown> => m !== null)
    .filter((m) => !type || m.type === type)
}
