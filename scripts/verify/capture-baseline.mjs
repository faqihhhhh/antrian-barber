import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  BEFORE_DIR,
  SCENARIOS,
  VIEWPORTS,
  launchChromium,
  openScenario,
  scenarioUrl,
  startServers,
  uniqueBaselinePath,
  waitForScenario,
} from './browser-fixtures.mjs'

const stopServers = await startServers()
let browser

try {
  browser = await launchChromium()
  await mkdir(BEFORE_DIR, { recursive: true })

  for (const scenario of SCENARIOS) {
    for (const viewport of VIEWPORTS) {
      const { context, page } = await openScenario(browser, scenario, viewport)
      try {
        await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await waitForScenario(page, scenario)
        if (scenario.id === 'website-home') {
          await page.frameLocator('iframe').getByText('Masuk ke Kapsflow', { exact: false }).waitFor({ state: 'visible', timeout: 20_000 })
        }
        const screenshotPath = await uniqueBaselinePath(scenario, viewport.width)
        await page.screenshot({ path: screenshotPath, animations: 'disabled', fullPage: false })
        console.log(`CAPTURE ${scenario.id} ${viewport.width}x${viewport.height} ${path.relative(path.resolve(BEFORE_DIR, '../..'), screenshotPath)}`)
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await browser?.close()
  await stopServers()
}
