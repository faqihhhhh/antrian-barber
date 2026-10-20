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

const scenario = SCENARIOS.find(({ id }) => id === 'app-tiket-waiting')
if (!scenario) throw new Error('Skenario tiket pelanggan tidak tersedia')

const failures = []
function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(label)
}

async function capturedMock(route, request, ticketStatus) {
  let responseOptions
  await mockApi({
    request: () => request,
    fulfill: (options) => {
      responseOptions = options
      return Promise.resolve()
    },
  }, scenario)
  const payload = JSON.parse(responseOptions.body)
  if (request.method() === 'GET' && new URL(request.url()).pathname === '/v1/me/tickets') {
    const ticket = payload.find((item) => item.ticket_id === TICKET_ID)
    if (ticket) {
      ticket.status = ticketStatus
      ticket.reviewed = ticketStatus === 'completed'
    }
  }
  await route.fulfill({ ...responseOptions, body: JSON.stringify(payload) })
}

const stopServers = await startServers()
const browser = await launchChromium()
try {
  const screenshotsDir = path.join(ROOT_DIR, 'frontend/ui-review/after')
  await mkdir(screenshotsDir, { recursive: true })

  for (const status of ['waiting', 'called', 'completed']) {
    const { context, page } = await openScenario(browser, scenario, { width: 390, height: 844 })
    await page.addInitScript(() => {
      if (!('PushManager' in window)) {
        Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} })
      }
      if (!('Notification' in window)) {
        Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'default' } })
      }
      if (!('serviceWorker' in navigator)) {
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: new Promise(() => {}) } })
      }
    })
    await page.unroute('**/v1/**')
    await page.route('**/v1/**', async (route) => capturedMock(route, route.request(), status))
    await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.getByRole('region', { name: `Tiket nomor 4` }).waitFor({ state: 'visible', timeout: 20_000 })

    const layout = await page.evaluate(() => {
      const main = document.querySelector('main')
      const children = [...main.children]
      const indexOf = (element) => children.indexOf(element)
      const stub = main.querySelector('[aria-label^="Tiket nomor"]')
      const stepper = main.querySelector('ol[aria-label="Tahapan tiket"]')
      const position = [...main.querySelectorAll('dt')].find((element) => element.textContent.trim() === 'Orang di depan Anda')
      const calledCard = [...main.querySelectorAll('h2')].find((element) => element.textContent.trim() === 'Giliran Anda!')
      const promptHeading = [...main.querySelectorAll('h2')].find((element) => element.textContent.includes('Dapatkan kabar saat giliran mendekat'))
      const bodyCard = position?.closest('section') ?? calledCard?.closest('section')
      const prompt = promptHeading?.closest('section')
      const labels = [...(stepper?.querySelectorAll('[data-step-label]') ?? [])]
      const activeLabel = stepper?.querySelector('[data-step-label]')
      const progressColors = [...(stepper?.querySelectorAll('[aria-hidden="true"] span') ?? [])]
        .map((element) => getComputedStyle(element).backgroundColor)
      const mobileNav = document.querySelector('div.fixed.inset-x-0.bottom-0')
      return {
        stubIndex: indexOf(stub),
        statusIndex: indexOf(bodyCard),
        stepperIndex: indexOf(stepper),
        promptIndex: indexOf(prompt),
        hasPosition: !!position,
        hasCalledCard: !!calledCard,
        hasPrompt: !!prompt,
        promptVisible: prompt ? getComputedStyle(prompt).display !== 'none' : false,
        labelFontSizes: labels.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
        activeLabel: activeLabel?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        progressColors,
        activeLabelBottom: activeLabel?.getBoundingClientRect().bottom ?? null,
        mobileNavTop: mobileNav?.getBoundingClientRect().top ?? null,
      }
    })

    const stepNumber = { waiting: 2, called: 3, completed: 5 }[status]
    const stepName = { waiting: 'Dalam antrian', called: 'Dipanggil', completed: 'Selesai' }[status]
    check(`${status}: label stepper minimal 12px`, layout.labelFontSizes.length > 0 && layout.labelFontSizes.every((size) => size >= 12), layout.labelFontSizes.join(', '))
    check(`${status}: hanya langkah aktif ditampilkan`, layout.activeLabel === `Langkah ${stepNumber} dari 5: ${stepName}`, String(layout.activeLabel))
    const activeColor = layout.progressColors[stepNumber - 1]
    const neighboringColors = [layout.progressColors[stepNumber - 2], layout.progressColors[stepNumber]].filter(Boolean)
    check(`${status}: garis langkah aktif punya warna pembeda`, !!activeColor && neighboringColors.every((color) => color !== activeColor), layout.progressColors.join(' | '))
    check(`${status}: label langkah tidak tertutup navigasi bawah`, layout.activeLabelBottom !== null && (layout.mobileNavTop === null || layout.activeLabelBottom <= layout.mobileNavTop), `${layout.activeLabelBottom}px / ${layout.mobileNavTop}px`)

    if (status === 'waiting') {
      check('waiting: status posisi tampil sebelum PushPrompt', layout.hasPosition && layout.hasPrompt && layout.statusIndex < layout.stepperIndex && layout.stepperIndex < layout.promptIndex, `indeks status/stepper/notifikasi ${layout.statusIndex}/${layout.stepperIndex}/${layout.promptIndex}`)
    } else if (status === 'called') {
      check('called: kartu giliran tampil setelah TicketStub dan sebelum stepper', layout.hasCalledCard && layout.stubIndex < layout.statusIndex && layout.statusIndex < layout.stepperIndex, `indeks tiket/status/stepper ${layout.stubIndex}/${layout.statusIndex}/${layout.stepperIndex}`)
      check('called: PushPrompt disembunyikan', !layout.hasPrompt)
    } else {
      check('completed: notifikasi disembunyikan dan status selesai tampil', !layout.hasPrompt && await page.getByText('Terima kasih, penilaian Anda sudah kami terima.').isVisible())
    }

    if (status === 'waiting') {
      await page.screenshot({ path: path.join(screenshotsDir, 'ticket-waiting-390.png'), fullPage: true })
    } else {
      await page.screenshot({ path: path.join(screenshotsDir, `ticket-${status}-390.png`), fullPage: true })
    }
    await context.close()
  }
} finally {
  await browser.close()
  await stopServers()
}

if (failures.length) {
  console.error(`\n${failures.length} pemeriksaan gagal.`)
  process.exitCode = 1
} else {
  console.log('\nSemua pemeriksaan tiket lulus.')
}
