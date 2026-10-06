import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from './node_modules/playwright/index.mjs'

export async function createMastraPage({
  viewport = { width: 1440, height: 1000 },
  colorScheme = 'dark',
  deviceScaleFactor = 2,
} = {}) {
  const authState = join(homedir(), '.agent-browser', 'auth', 'mastra-platform-test.json')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    colorScheme,
    deviceScaleFactor,
    storageState: existsSync(authState) ? authState : undefined,
    viewport,
  })
  const page = await context.newPage()

  return {
    browser,
    context,
    page,
    close: () => browser.close(),
  }
}
