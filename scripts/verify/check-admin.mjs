import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import {
  ROOT_DIR,
  SCENARIOS,
  TICKET_ID,
  launchChromium,
  mockApi,
  openScenario,
  scenarioUrl,
  startServers,
} from './browser-fixtures.mjs'

const scenario = SCENARIOS.find(({ id }) => id === 'app-admin-kelola')
if (!scenario) throw new Error('Fixture admin tidak tersedia')

async function mockAdmin(route, request, { noSessions = false } = {}) {
  let responseOptions
  await mockApi({ request: () => request, fulfill: (options) => { responseOptions = options; return Promise.resolve() } }, scenario)
  const pathname = new URL(request.url()).pathname
  let payload = JSON.parse(responseOptions.body)
  if (noSessions && request.method() === 'GET' && /\/outlets\/[0-9a-f-]+\/queue-sessions$/.test(pathname)) {
    payload = []
  }
  if (request.method() === 'GET' && /\/pending-manual-payments$/.test(pathname)) {
    payload = [{
      ticket_id: TICKET_ID,
      ticket_number: 12,
      customer_name: 'Dina',
      match_code: 'A7K2Q9',
      method: 'manual',
      amount_rupiah: 20123,
      unique_code: 123,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    }]
  }
  await route.fulfill({ ...responseOptions, body: JSON.stringify(payload) })
}

const stopServers = await startServers()
const browser = await launchChromium()
try {
  const { context, page } = await openScenario(browser, scenario, { width: 390, height: 844 })
  await page.unroute('**/v1/**')
  await page.route('**/v1/**', (route) => mockAdmin(route, route.request()))
  await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.getByRole('heading', { name: 'Meja admin' }).waitFor({ state: 'visible', timeout: 20_000 })
  const confirmButton = page.getByRole('button', { name: 'Konfirmasi DP dan masukkan ke antrean' })
  await confirmButton.waitFor({ state: 'visible', timeout: 20_000 })

  const buttonTop = await confirmButton.evaluate((element) => element.getBoundingClientRect().top)
  const details = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Buka sesi baru' }) })
  const disclosureOpenInitially = await details.evaluate((element) => element.open)
  console.log(`${buttonTop <= 600 ? 'PASS' : 'FAIL'} Tombol konfirmasi DP berada di 600px pertama — top ${Math.round(buttonTop)}px`)
  console.log(`${!disclosureOpenInitially ? 'PASS' : 'FAIL'} Form buka sesi tertutup saat sesi sudah dibuka — open=${disclosureOpenInitially}`)

  const summary = page.locator('summary').filter({ hasText: 'Buka sesi baru' })
  await summary.focus()
  await page.keyboard.press('Enter')
  const opensByKeyboard = await details.evaluate((element) => element.open)
  console.log(`${opensByKeyboard ? 'PASS' : 'FAIL'} Disclosure buka sesi dapat dibuka dengan keyboard — open=${opensByKeyboard}`)

  const noSessionPage = await openScenario(browser, scenario, { width: 390, height: 844 })
  await noSessionPage.page.unroute('**/v1/**')
  await noSessionPage.page.route('**/v1/**', (route) => mockAdmin(route, route.request(), { noSessions: true }))
  await noSessionPage.page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await noSessionPage.page.getByText('Belum ada sesi antrian di outlet ini.', { exact: false }).waitFor({ state: 'visible', timeout: 20_000 })
  const opensWithoutSession = await noSessionPage.page.locator('details').filter({ has: noSessionPage.page.locator('summary').filter({ hasText: 'Buka sesi baru' }) }).evaluate((element) => element.open)
  console.log(`${opensWithoutSession ? 'PASS' : 'FAIL'} Disclosure terbuka jika belum ada sesi — open=${opensWithoutSession}`)

  const failures = []
  if (buttonTop > 600) failures.push('Tombol konfirmasi DP melewati 600px')
  if (disclosureOpenInitially) failures.push('Form buka sesi terbuka saat sesi aktif')
  if (!opensByKeyboard) failures.push('Disclosure tidak dapat dibuka dengan keyboard')
  if (!opensWithoutSession) failures.push('Disclosure tidak terbuka saat belum ada sesi')
  if (failures.length === 0) {
    const outputDir = path.join(ROOT_DIR, 'frontend/ui-review/after')
    await mkdir(outputDir, { recursive: true })
    await page.keyboard.press('Enter')
    await page.screenshot({ path: path.join(outputDir, 'admin-390.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: path.join(outputDir, 'admin-1440.png'), fullPage: true })
    console.log('PASS Tangkapan layar admin 390px dan 1440px tersimpan')
  }

  await context.close()
  await noSessionPage.context.close()
  if (failures.length) {
    console.error(`\n${failures.length} pemeriksaan gagal: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('\nSemua pemeriksaan layar admin lulus.')
  }
} finally {
  await browser.close()
  await stopServers()
}
