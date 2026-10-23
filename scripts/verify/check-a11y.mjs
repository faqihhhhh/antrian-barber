import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_URL,
  ROOT_DIR,
  WEBSITE_URL,
  launchChromium,
  openScenario,
  scenarioUrl,
  startServers,
  waitForScenario,
} from './browser-fixtures.mjs'

const verifyDir = path.dirname(fileURLToPath(import.meta.url))
const axePath = path.join(verifyDir, 'node_modules', 'axe-core', 'axe.min.js')
assert.ok(existsSync(axePath), `axe-core tidak ditemukan di ${axePath}`)

const scenarios = [
  { id: 'website-home', kind: 'website', path: '/' },
  { id: 'app-masuk', kind: 'app', path: '/masuk', role: 'guest' },
  { id: 'app-outlet-contoh-barber', kind: 'app', path: '/o/contoh-barber', role: 'guest' },
]
const stopServers = await startServers()
let browser
const failures = []
const screenshotDirectory = path.join(ROOT_DIR, 'frontend', 'ui-review', 'after')
await mkdir(screenshotDirectory, { recursive: true })

try {
  browser = await launchChromium()
  for (const scenario of scenarios) {
    const { context, page } = await openScenario(browser, scenario, { width: 390, height: 844 })
    try {
      await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await waitForScenario(page, scenario)
      await page.screenshot({ path: path.join(screenshotDirectory, `a11y-${scenario.id}-390.png`) })
      await page.addScriptTag({ path: axePath })
      const result = await page.evaluate(async () => window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      }))
      const seriousViolations = result.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))
      console.log(`PAGE ${scenario.id}: ${seriousViolations.length} pelanggaran axe berdampak serius/kritis`)
      for (const violation of seriousViolations) {
        const details = violation.nodes.map((node) => `${node.target.join(', ')} (${node.failureSummary?.replace(/\s+/g, ' ').trim() ?? 'gagal aturan'})`).join('; ')
        console.log(`  ${violation.impact} ${violation.id}: ${violation.help} — ${details}`)
        failures.push(`${scenario.id}: ${violation.id} (${violation.impact})`)
      }

      if (scenario.kind === 'app') {
        const labels = await page.evaluate(() => ({
          logos: [...document.querySelectorAll('[aria-label="Trimwait"]')].map((element) => ({ tag: element.tagName, role: element.getAttribute('role') })),
          dateGroupRole: document.querySelector('[aria-label="Tanggal yang sudah dibuka"]')?.getAttribute('role') ?? null,
        }))
        if (labels.logos.some((logo) => logo.role !== 'img')) {
          console.log(`  FAIL ${scenario.id}: logo berlabel tanpa role img`)
          failures.push(`${scenario.id}: logo berlabel tanpa role img`)
        }
        if (scenario.id === 'app-outlet-contoh-barber' && labels.dateGroupRole !== 'group') {
          console.log(`  FAIL ${scenario.id}: pemilih tanggal tanpa role group`)
          failures.push(`${scenario.id}: pemilih tanggal tanpa role group`)
        }
      }

      if (scenario.id === 'app-masuk') {
        await page.keyboard.press('Tab')
        const focus = await page.evaluate(() => {
          const style = getComputedStyle(document.activeElement)
          return { tag: document.activeElement?.tagName, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
        })
        const visibleOutline = focus.outlineStyle !== 'none' && Number.parseFloat(focus.outlineWidth) >= 2
        console.log(`FOCUS /masuk: ${focus.tag} outline ${focus.outlineStyle} ${focus.outlineWidth} — ${visibleOutline ? 'PASS' : 'FAIL'}`)
        if (!visibleOutline) failures.push(`/masuk: fokus keyboard tidak memiliki outline minimal 2px`)
      }
    } finally {
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await stopServers()
}

assert.deepEqual(failures, [], failures.length ? failures.join('\n') : 'Tidak ada pelanggaran serius/kritis.')
console.log(`PASS: ${scenarios.length} halaman bebas pelanggaran axe serius/kritis dan fokus /masuk terlihat.`)
