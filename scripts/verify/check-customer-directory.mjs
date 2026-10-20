import {
  launchChromium,
  openScenario,
  scenarioUrl,
  startServers,
} from './browser-fixtures.mjs'

const scenario = { id: 'customer-home', kind: 'app', path: '/pelanggan', role: 'customer' }
const failures = []
function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(label)
}

const stopServers = await startServers()
const browser = await launchChromium()
try {
  const { context, page } = await openScenario(browser, scenario, { width: 390, height: 844 })
  await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded' })
  const select = page.getByRole('combobox', { name: 'Pilih barbershop atau salon' })
  await select.waitFor({ state: 'visible', timeout: 20_000 })
  const options = await select.locator('option').allTextContents()
  check('Daftar outlet memuat nama bisnis dan cabang', options.includes('Salon Cantik Selalu — Salon Cabang Utama') && options.includes('Barber Contoh — Cabang Selatan'), options.join(' | '))
  await select.selectOption('barber-contoh-selatan')
  await page.waitForURL((url) => url.pathname === '/o/barber-contoh-selatan', { timeout: 10_000 })
  check('Memilih outlet membuka tautan publik outlet', new URL(page.url()).pathname === '/o/barber-contoh-selatan', new URL(page.url()).pathname)
  await context.close()

  if (failures.length) {
    console.error(`\n${failures.length} pemeriksaan gagal: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('\nSemua pemeriksaan daftar outlet pelanggan lulus.')
  }
} finally {
  await browser.close()
  await stopServers()
}
