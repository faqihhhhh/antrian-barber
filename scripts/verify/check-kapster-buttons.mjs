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

const before = process.argv.includes('--capture-before')
const screenshotDirectory = path.join(ROOT_DIR, 'frontend/ui-review', before ? 'before' : 'after')
const scenario = SCENARIOS.find(({ id }) => id === 'app-kapster')
const failures = []

function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(label)
}

async function mockKapsterApi(route, state) {
  const request = route.request()
  let options
  await mockApi({ request: () => request, fulfill: (value) => { options = value; return Promise.resolve() } }, scenario)
  const pathname = new URL(request.url()).pathname
  if (request.method() === 'GET' && /\/queue-sessions\/[0-9a-f-]+\/kapster-states$/.test(pathname)) {
    options.body = JSON.stringify([{ membership_id: MEMBERSHIP_ID, status: state, current_ticket_id: state === 'idle' ? null : TICKET_ID }])
  }
  if (request.method() === 'GET' && /\/queue-sessions\/[0-9a-f-]+\/tickets$/.test(pathname) && state !== 'idle') {
    const tickets = JSON.parse(options.body)
    options.body = JSON.stringify(tickets.map((ticket) => ticket.id === TICKET_ID ? { ...ticket, status: state === 'busy' ? 'in_progress' : 'called' } : ticket))
  }
  if (request.method() === 'POST' && pathname.endsWith('/ready')) {
    options.body = JSON.stringify({ message: 'Siap — antrian masih kosong' })
  }
  await route.fulfill(options)
}

const stopServers = await startServers()
const browser = await launchChromium()
try {
  await mkdir(screenshotDirectory, { recursive: true })
  for (const stateCase of [
    { state: 'idle', button: 'Siap', screenshot: 'kapster-actions-idle-390.png' },
    { state: 'called', button: 'Mulai layanan', screenshot: 'kapster-actions-called-390.png' },
    { state: 'busy', button: 'Selesaikan', screenshot: 'kapster-actions-busy-390.png' },
  ]) {
    const { context, page } = await openScenario(browser, scenario, { width: 390, height: 844 })
    await page.unroute('**/v1/**')
    let readyRequestReceived = false
    await page.route('**/v1/**', async (route) => {
      if (route.request().method() === 'POST' && new URL(route.request().url()).pathname.endsWith('/ready')) readyRequestReceived = true
      await mockKapsterApi(route, stateCase.state)
    })
    try {
      await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
      const button = page.getByRole('button', { name: stateCase.button, exact: true })
      await button.waitFor({ state: 'visible', timeout: 20_000 })
      const visual = await button.evaluate((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return {
          enabled: !element.disabled,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          background: style.backgroundColor,
          color: style.color,
          radius: style.borderRadius,
        }
      })
      const appearancePassed = visual.enabled && visual.width > 200 && visual.height >= 44 && visual.height <= 52 && visual.background === 'rgb(23, 23, 23)' && visual.color === 'rgb(255, 255, 255)' && visual.radius === '12px'
      check(`${stateCase.button}: jelas sebagai tombol utama`, appearancePassed, JSON.stringify(visual))
      if (stateCase.state === 'called') {
        const secondary = await page.getByRole('button', { name: 'Ganti pelanggan', exact: true }).evaluate((element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            background: style.backgroundColor,
            color: style.color,
            radius: style.borderRadius,
            borderWidth: style.borderTopWidth,
          }
        })
        const secondaryPassed = secondary.width > 200 && secondary.height >= 44 && secondary.background === 'rgb(255, 255, 255)' && secondary.color === 'rgb(23, 23, 23)' && secondary.radius === '12px' && secondary.borderWidth === '1px'
        check('Ganti pelanggan: jelas sebagai tombol sekunder', secondaryPassed, JSON.stringify(secondary))
      }
      if (stateCase.state === 'idle') {
        await button.click()
        await page.waitForTimeout(100)
        check('Klik Siap mengirim permintaan API', readyRequestReceived)
      }
      await page.screenshot({ path: path.join(screenshotDirectory, `${before ? 'before' : 'after'}-${stateCase.screenshot}`), fullPage: false })
    } catch (error) {
      check(`${stateCase.button}: tersedia dan dapat diperiksa`, false, error.message)
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
  console.log(`\nSemua tombol kapster terlihat dan bekerja. Screenshot ${before ? 'before' : 'after'} tersimpan.`)
}
