import { test, expect } from '../../fixtures/game'

test.describe.skip('Command Input', () => {
  test('input field accepts text and clears on Enter', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('status')
    await expect(input).toHaveValue('status')
    await input.press('Enter')
    await expect(input).toHaveValue('')
  })

  test('typing "move " shows zone autocomplete suggestions', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('move ')
    // Autocomplete dropdown should appear with zone suggestions
    const suggestions = gamePage.locator('.cmd-input-wrapper .bg-bg-panel')
    await expect(suggestions).toBeVisible({ timeout: 3_000 })
  })

  test('arrow keys navigate autocomplete; Tab accepts suggestion', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('move ')
    // Wait for suggestions
    await gamePage.locator('.cmd-input-wrapper .bg-bg-panel').waitFor({ timeout: 3_000 })
    // Press down arrow to select
    await input.press('ArrowDown')
    // Press Tab to accept
    await input.press('Tab')
    // Input should now have the accepted suggestion
    const value = await input.inputValue()
    expect(value.length).toBeGreaterThan(5) // "move " + zone name
  })

  test('up arrow cycles command history', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    // Submit a command first
    await input.fill('status')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    // Press up arrow to recall
    await input.press('ArrowUp')
    await expect(input).toHaveValue('status')
  })

  test('valid commands show green >> preview; errors show red !!', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    const cmdWrapper = gamePage.getByTestId('command-input')

    // Type a valid command
    await input.fill('status')
    await expect(cmdWrapper.getByText('>>')).toBeVisible({ timeout: 2_000 })

    // Type an invalid command
    await input.fill('invalidcommand xyz')
    await expect(cmdWrapper.getByText('!!')).toBeVisible({ timeout: 2_000 })
  })

  test('escape clears input', async ({ gamePage }) => {
    const input = gamePage.getByTestId('command-input-field')
    await input.fill('some text')
    await input.press('Escape')
    await expect(input).toHaveValue('')
  })
})
