import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  ROOT_DIR,
  SCENARIOS,
  TICKET_ID,
  MEMBERSHIP_ID,
  launchChromium,
  mockApi,
  openScenario,
  scenarioUrl,
  startServers,
} from './browser-fixtures.mjs'

const kapsterScenario = SCENARIOS.find(({ id }) => id === 'app-kapster')
const customerScenario = SCENARIOS.find(({ id }) => id === 'app-tiket-waiting')
if (!kapsterScenario || !customerScenario) throw new Error('Fixture kapster atau pelanggan tidak tersedia')

const failures = []
function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(label)
}

async function fulfillFixture(route, scenario, { busy = false } = {}) {
  const request = route.request()
  let options
  await mockApi({ request: () => request, fulfill: (value) => { options = value; return Promise.resolve() } }, scenario)
  const pathname = new URL(request.url()).pathname
  let payload = JSON.parse(options.body)
  if (busy && request.method() === 'GET' && /\/queue-sessions\/[0-9a-f-]+\/kapster-states$/.test(pathname)) {
    payload = [{ membership_id: MEMBERSHIP_ID, status: 'busy', current_ticket_id: TICKET_ID }]
  }
  if (busy && request.method() === 'GET' && /\/queue-sessions\/[0-9a-f-]+\/tickets$/.test(pathname)) {
    payload = payload.map((ticket) => ticket.id === TICKET_ID ? { ...ticket, status: 'in_progress' } : ticket)
  }
  await route.fulfill({ ...options, body: JSON.stringify(payload) })
}

async function kapsterPage(browser, { busy = false, connected = true } = {}) {
  const { context, page } = await openScenario(browser, kapsterScenario, { width: 390, height: 844 })
  await page.unroute('**/v1/**')
  await page.route('**/v1/**', (route) => fulfillFixture(route, kapsterScenario, { busy }))
  if (!connected) {
    await page.addInitScript(() => {
      class DisconnectedEventSource {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSED = 2
        readyState = DisconnectedEventSource.CONNECTING
        onopen = null
        onerror = null
        onmessage = null
        constructor(url) {
          this.url = url
          queueMicrotask(() => { this.readyState = DisconnectedEventSource.CLOSED; this.onerror?.(new Event('error')) })
        }
        close() { this.readyState = DisconnectedEventSource.CLOSED }
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() { return true }
      }
      Object.defineProperty(window, 'EventSource', { configurable: true, writable: true, value: DisconnectedEventSource })
    })
  }
  await page.goto(scenarioUrl(kapsterScenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.getByRole('region', { name: 'Pelanggan aktif' }).waitFor({ state: 'visible', timeout: 20_000 })
  if (busy) await page.getByText('Raka Pratama', { exact: true }).waitFor({ state: 'visible' })
  return { context, page }
}

async function customerPage(browser) {
  const { context, page } = await openScenario(browser, customerScenario, { width: 390, height: 844 })
  await page.goto(scenarioUrl(customerScenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.getByText('Terhubung langsung', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
  return { context, page }
}

const stopServers = await startServers()
const browser = await launchChromium()
try {
  const busy = await kapsterPage(browser, { busy: true })
  const visual = await busy.page.getByRole('region', { name: 'Pelanggan aktif' }).evaluate((region) => {
    const elements = [...region.querySelectorAll('p, h2')]
    const name = elements.find((element) => element.textContent.trim() === 'Raka Pratama')
    const number = elements.find((element) => element.textContent.trim() === '#4' || element.textContent.trim() === '4')
    return {
      nameSize: name ? Number.parseFloat(getComputedStyle(name).fontSize) : null,
      numberSize: number ? Number.parseFloat(getComputedStyle(number).fontSize) : null,
    }
  })
  check('Nama pelanggan lebih besar dari nomor tiket', visual.nameSize !== null && visual.numberSize !== null && visual.nameSize > visual.numberSize, `${visual.nameSize ?? 'tidak ditemukan'}px vs ${visual.numberSize ?? 'tidak ditemukan'}px`)

  const disconnected = await kapsterPage(browser, { connected: false })
  await disconnected.page.waitForTimeout(250)
  const pollingText = await disconnected.page.getByText(/setiap 5 detik/i).count()
  check('Teks polling tidak ditampilkan di kapster', pollingText === 0, `ditemukan ${pollingText}`)

  const customer = await customerPage(browser)
  const colors = await Promise.all([
    busy.page.locator('[data-connection-dot]').first().evaluate((element) => getComputedStyle(element).backgroundColor).catch(() => null),
    customer.page.locator('[data-connection-dot]').first().evaluate((element) => getComputedStyle(element).backgroundColor).catch(() => null),
  ])
  check('Warna indikator koneksi sama di kapster dan pelanggan', Boolean(colors[0] && colors[1] && colors[0] === colors[1]), `${colors[0] ?? 'indikator kapster tidak ditemukan'} / ${colors[1] ?? 'indikator pelanggan tidak ditemukan'}`)

  if (failures.length === 0) {
    const screenshotsDir = path.join(ROOT_DIR, 'frontend/ui-review/after')
    await mkdir(screenshotsDir, { recursive: true })
    await busy.page.screenshot({ path: path.join(screenshotsDir, 'kapster-busy-390.png'), fullPage: true })
    const idle = await kapsterPage(browser)
    await idle.page.screenshot({ path: path.join(screenshotsDir, 'kapster-idle-390.png'), fullPage: true })
    await idle.context.close()
  }
  await busy.context.close()
  await disconnected.context.close()
  await customer.context.close()
} finally {
  await browser.close()
  await stopServers()
}

if (failures.length) {
  console.error(`\n${failures.length} pemeriksaan gagal: ${failures.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('\nSemua pemeriksaan layar staf lulus; tangkapan layar tersimpan.')
}
