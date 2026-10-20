import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import {
  ROOT_DIR,
  SCENARIOS,
  launchChromium,
  openScenario,
  scenarioUrl,
  startServers,
  waitForScenario,
} from './browser-fixtures.mjs'

const scenario = SCENARIOS.find(({ id }) => id === 'app-outlet-contoh-barber')
if (!scenario) throw new Error('Skenario outlet pelanggan tidak tersedia')

const stopServers = await startServers()
const browser = await launchChromium()
try {
  const page = await openScenario(browser, scenario, { width: 1440, height: 900 }).then(({ page }) => page)
  await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForScenario(page, scenario)

  const columnData = await page.locator('main > div.grid').evaluate((element) => {
    const styles = getComputedStyle(element)
    return {
      columns: styles.gridTemplateColumns,
      count: styles.gridTemplateColumns.trim().split(/\s+/).length,
    }
  })
  console.log(`MEASURE grid 1440px ${JSON.stringify(columnData)}`)
  assert.equal(columnData.count, 2, `Layout desktop harus punya dua kolom; didapat: ${columnData.columns}`)
  console.log(`PASS Grid outlet 1440px memiliki dua kolom (${columnData.columns})`)

  const outputDir = path.join(ROOT_DIR, 'frontend/ui-review/after')
  await mkdir(outputDir, { recursive: true })
  await page.screenshot({ path: path.join(outputDir, 'booking-outlet-1440.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(outputDir, 'booking-outlet-390.png'), fullPage: true })
  await page.getByRole('textbox', { name: 'Nama yang dipanggil kapster' }).fill('Budi')
  await page.getByRole('link', { name: 'Masuk untuk memesan' }).click()
  await page.waitForURL('**/pelanggan/masuk')
  const saved = await page.evaluate(() => localStorage.getItem('kapsflow.nama'))
  assert.equal(saved, 'Budi', `Nama harus tersimpan sebelum redirect; didapat: ${JSON.stringify(saved)}`)
  await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForScenario(page, scenario)
  const restored = await page.getByRole('textbox', { name: 'Nama yang dipanggil kapster' }).inputValue()
  assert.equal(restored, 'Budi', `Nama harus terisi lagi saat kembali ke outlet; didapat: ${JSON.stringify(restored)}`)

  console.log('PASS Nama Budi tersimpan ke localStorage sebelum pelanggan masuk')
  console.log('PASS Nama Budi terisi lagi saat pelanggan kembali ke outlet')
  console.log('PASS Screenshot outlet 390px dan 1440px tersimpan di frontend/ui-review/after/')
} finally {
  await browser.close()
  await stopServers()
}
