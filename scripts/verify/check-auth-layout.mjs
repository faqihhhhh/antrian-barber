import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  ROOT_DIR,
  SCENARIOS,
  launchChromium,
  openScenario,
  scenarioUrl,
  startServers,
  waitForScenario,
} from './browser-fixtures.mjs'

const before = process.argv.includes('--capture-before')
const directory = path.join(ROOT_DIR, 'frontend/ui-review', before ? 'before' : 'after')
const scenario = SCENARIOS.find(({ id }) => id === 'app-masuk')
const failures = []

function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(label)
}

const stopServers = await startServers()
const browser = await launchChromium()
try {
  await mkdir(directory, { recursive: true })
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const { context, page } = await openScenario(browser, scenario, viewport)
    try {
      await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded' })
      await waitForScenario(page, scenario)

      const panel = page.locator('[data-login-panel]')
      const panelInfo = await panel.count()
        ? await panel.evaluate((element) => ({
          visible: element.getBoundingClientRect().width > 0 && getComputedStyle(element).display !== 'none',
          text: element.innerText,
        }))
        : { visible: false, text: '' }
      check(`Panel brand tampil pada ${viewport.width}px`, panelInfo.visible, `terlihat=${panelInfo.visible}`)
      check(`Panel brand memuat pesan utama pada ${viewport.width}px`, panelInfo.text.includes('Antrian lancar') && panelInfo.text.includes('pelanggan nyaman'))
      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      check(`Halaman masuk tidak melebar di ${viewport.width}px`, !horizontalOverflow)

      const pole = page.locator('[data-login-pole] path').first()
      const poleColor = await pole.count()
        ? await pole.evaluate((element) => getComputedStyle(element).stroke)
        : 'tidak ditemukan'
      check(`Ilustrasi barber memakai indigo pada ${viewport.width}px`, poleColor === 'rgb(67, 56, 202)', poleColor)

      const name = `${before ? 'before' : 'after'}-login-brand-${viewport.width}.png`
      await page.screenshot({ path: path.join(directory, name), animations: 'disabled', fullPage: false })
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  await stopServers()
}

if (failures.length) {
  console.error(`\n${failures.length} pemeriksaan gagal: ${failures.join('; ')}`)
  process.exitCode = 1
} else {
  console.log(`\nSemua pemeriksaan tata letak login lulus. Screenshot ${before ? 'before' : 'after'} tersimpan.`)
}
