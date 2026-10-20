import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import {
  APP_URL,
  ROOT_DIR,
  SCENARIOS,
  launchChromium,
  mockApi,
  openScenario,
  scenarioUrl,
  startServers,
} from './browser-fixtures.mjs'

const scenario = SCENARIOS.find(({ id }) => id === 'app-outlet-contoh-barber')
if (!scenario) throw new Error('Skenario outlet pelanggan tidak tersedia')

const stopServers = await startServers()
const browser = await launchChromium()
try {
  const { context, page } = await openScenario(browser, scenario, { width: 1440, height: 900 })
  await page.unroute('**/v1/**')
  await page.route('**/v1/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    if (request.method() === 'GET' && pathname === '/v1/public/outlets/contoh-barber') {
      let responseOptions
      await mockApi({
        request: () => request,
        fulfill: (options) => {
          responseOptions = options
          return Promise.resolve()
        },
      }, scenario)
      const payload = JSON.parse(responseOptions.body)
      payload.days[13] = {
        ...payload.days[13],
        date: 'bukan-tanggal',
        session_id: '33333333-3333-4333-8333-333333333333',
        open: true,
      }
      await route.fulfill({ ...responseOptions, body: JSON.stringify(payload) })
      return
    }
    await mockApi(route, scenario)
  })

  await page.goto(`${APP_URL}${scenario.path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.getByRole('heading', { name: 'Pesan antrian' }).waitFor({ state: 'visible', timeout: 20_000 })
  const invalidTileCount = await page.locator('input[name="tanggal-antrian"][value="bukan-tanggal"]').count()
  const renderedTileCount = await page.locator('input[name="tanggal-antrian"]').count()
  const pageText = await page.locator('body').innerText()
  assert.equal(invalidTileCount, 0, 'Tile untuk tanggal tidak valid harus disembunyikan')
  assert.equal(renderedTileCount, 1, 'Hanya tile tanggal valid yang seharusnya tampil')
  assert.equal(pageText.includes('Invalid Date'), false, 'Teks Invalid Date tidak boleh tampil')
  assert.equal(pageText.includes('bukan-tanggal'), false, 'Nilai tanggal mentah tidak boleh tampil')

  const screenshotPath = path.join(ROOT_DIR, 'frontend/ui-review/after/outlet-1440.png')
  await mkdir(path.dirname(screenshotPath), { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await context.close()

  console.log('PASS Tile tanggal tidak valid disembunyikan')
  console.log('PASS Halaman tidak memuat teks Invalid Date atau tanggal mentah')
  console.log(`PASS Screenshot disimpan: ${path.relative(ROOT_DIR, screenshotPath)}`)
} finally {
  await browser.close()
  await stopServers()
}
