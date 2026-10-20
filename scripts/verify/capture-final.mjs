import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  ROOT_DIR,
  SCENARIOS,
  VIEWPORTS,
  launchChromium,
  openScenario,
  scenarioUrl,
  startServers,
  waitForScenario,
} from './browser-fixtures.mjs'

const outputDirectory = path.join(ROOT_DIR, 'frontend', 'ui-review', 'after')
const stopServers = await startServers()
let browser

try {
  browser = await launchChromium()
  await mkdir(outputDirectory, { recursive: true })

  for (const scenario of SCENARIOS) {
    for (const viewport of VIEWPORTS) {
      const { context, page } = await openScenario(browser, scenario, viewport)
      try {
        await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await waitForScenario(page, scenario)
        const filename = `final-${scenario.id}-${viewport.width}.png`
        const screenshotPath = path.join(outputDirectory, filename)
        await page.screenshot({ path: screenshotPath, animations: 'disabled', fullPage: false })
        console.log(`CAPTURE ${scenario.id} ${viewport.width}x${viewport.height} ${screenshotPath}`)
      } finally {
        await context.close()
      }
    }
  }
} finally {
  await browser?.close()
  await stopServers()
}
