import { mkdir, readFile } from 'node:fs/promises'
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

const before = process.argv.includes('--capture-before')
const screenshotDirectory = path.join(ROOT_DIR, 'frontend', 'ui-review', before ? 'before' : 'after')
const css = await readFile(path.join(ROOT_DIR, 'frontend/src/index.css'), 'utf8')
const ui = await readFile(path.join(ROOT_DIR, 'frontend/src/components/ui.tsx'), 'utf8')
const website = await readFile(path.join(ROOT_DIR, 'website/src/pages/index.astro'), 'utf8')
const failures = []

function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(label)
}

function linearChannel(value) {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const value = hex.replace('#', '')
  const channels = value.match(/.{2}/g).map((channel) => linearChannel(Number.parseInt(channel, 16)))
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

check('Token --color-accent tersedia', /--color-accent:\s*#4338ca\b/i.test(css))
check('Tombol utama tetap memakai bg-ink', /primary:\s*'bg-ink\s+text-white\s+hover:bg-ink-hover'/.test(ui))
check('Website tidak memakai amber lama', !/#(?:d29357|d58f4e|df9a57|e5a15d|e7ac72)\b/i.test(website))

const lightContrast = contrast('#4338CA', '#F8FAFC')
const darkContrast = contrast('#A5B4FC', '#1E293B')
check('Kontras aksen pada paper minimal 4,5:1', lightContrast >= 4.5, `${lightContrast.toFixed(2)}:1`)
check('Kontras aksen-on-dark pada ink minimal 4,5:1', darkContrast >= 4.5, `${darkContrast.toFixed(2)}:1`)

const stopServers = await startServers()
let browser
try {
  browser = await launchChromium()
  await mkdir(screenshotDirectory, { recursive: true })

  const websiteScenario = SCENARIOS.find(({ id }) => id === 'website-home')
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    await page.goto(scenarioUrl(websiteScenario), { waitUntil: 'networkidle' })
    const name = `${before ? 'before' : 'after'}-website-home-${viewport.width}.png`
    await page.screenshot({ path: path.join(screenshotDirectory, name), animations: 'disabled', fullPage: false })
    await page.close()
  }

  const screenshots = [
    { id: 'app-masuk', file: 'app-masuk' },
    { id: 'app-outlet-contoh-barber', file: 'app-outlet-contoh-barber' },
    { id: 'app-admin-kelola', file: 'app-admin-kelola' },
  ]
  for (const viewport of VIEWPORTS) {
    for (const target of screenshots) {
      const scenario = SCENARIOS.find(({ id }) => id === target.id)
      const { context, page } = await openScenario(browser, scenario, viewport)
      try {
        await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded' })
        await waitForScenario(page, scenario)
        const name = `${before ? 'before' : 'after'}-${target.file}-${viewport.width}.png`
        await page.screenshot({ path: path.join(screenshotDirectory, name), animations: 'disabled', fullPage: false })
      } finally {
        await context.close()
      }
    }

    if (viewport.width === 1440) {
      const loginScenario = SCENARIOS.find(({ id }) => id === 'app-masuk')
      const { context, page } = await openScenario(browser, loginScenario, viewport)
      try {
        await page.goto(scenarioUrl(loginScenario), { waitUntil: 'domcontentloaded' })
        await waitForScenario(page, loginScenario)
        const accent = page.locator('[data-login-accent]')
        const result = await accent.count()
          ? await accent.evaluate((element) => ({ visible: element.getBoundingClientRect().width > 0, color: getComputedStyle(element).color }))
          : { visible: false, color: 'tidak ditemukan' }
        check('Panel samping login memakai aksen on-dark', result.visible && result.color === 'rgb(165, 180, 252)', `${result.color}; terlihat=${result.visible}`)
      } catch (error) {
        check('Panel samping login memakai aksen on-dark', false, error.message)
      }
      const name = `${before ? 'before' : 'after'}-app-masuk-${viewport.width}.png`
      await page.screenshot({ path: path.join(screenshotDirectory, name), animations: 'disabled', fullPage: false })
      await context.close()
    }

    const ticketScenario = { id: 'app-tiket-in-progress', kind: 'app', path: `/tiket/${'44444444-4444-4444-8444-444444444444'}`, role: 'customer' }
    const { context, page } = await openScenario(browser, ticketScenario, viewport)
    try {
      await page.route('**/v1/me/tickets', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          ticket_id: '44444444-4444-4444-8444-444444444444',
          tenant_id: '11111111-1111-4111-8111-111111111111',
          outlet_id: '22222222-2222-4222-8222-222222222222',
          outlet_name: 'Salon Cabang Utama',
          outlet_slug: 'contoh-barber',
          outlet_timezone: 'Asia/Jakarta',
          session_id: '33333333-3333-4333-8333-333333333333',
          session_date: new Date().toISOString().slice(0, 10),
          ticket_number: 4,
          status: 'in_progress',
          match_code: 'A7K2Q9',
          customer_name: 'Raka Pratama',
          payment: null,
          estimate: { tickets_ahead: 0, active_kapsters: 2, estimated_wait_minutes: 0 },
          reviewed: false,
        }]),
      }))
      await page.goto(scenarioUrl(ticketScenario), { waitUntil: 'domcontentloaded' })
      await page.getByText('Langkah 4 dari 5: Sedang dilayani', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
      const colors = await page.locator('li[aria-current="step"]').evaluate((step) => ({
        label: getComputedStyle(step.querySelector('[data-step-label]')).color,
        bar: getComputedStyle(step.querySelectorAll('div[aria-hidden="true"] span')[3]).backgroundColor,
      }))
      check('Langkah tiket in_progress memakai warna aksen', colors.label === 'rgb(67, 56, 202)' && colors.bar === 'rgb(67, 56, 202)', `teks ${colors.label}; bar ${colors.bar}`)
      const filename = `${before ? 'before' : 'after'}-app-tiket-in-progress-${viewport.width}.png`
      await page.screenshot({ path: path.join(screenshotDirectory, filename), animations: 'disabled', fullPage: false })
    } catch (error) {
      check('Langkah tiket in_progress memakai warna aksen', false, error.message)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await stopServers()
}

if (failures.length) {
  console.error(`\n${failures.length} pemeriksaan gagal: ${failures.join('; ')}`)
  process.exitCode = 1
} else {
  console.log(`\nSemua pemeriksaan aksen lulus. Screenshot ${before ? 'before' : 'after'} tersimpan.`)
}
