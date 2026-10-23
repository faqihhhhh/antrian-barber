import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import {
  MEMBERSHIP_ID,
  OUTLET_ID,
  ROOT_DIR,
  SCENARIOS,
  TENANT_ID,
  launchChromium,
  mockApi,
  openScenario,
  scenarioUrl,
  startServers,
} from './browser-fixtures.mjs'

const guestScenario = SCENARIOS.find(({ id }) => id === 'app-masuk')
if (!guestScenario) throw new Error('Fixture halaman masuk tidak tersedia')

const testRoles = [
  { id: 'owner', roles: ['owner'], expectedPath: '/pemilik' },
  { id: 'admin', roles: ['admin'], expectedPath: `/kelola/${TENANT_ID}/${OUTLET_ID}` },
  { id: 'kapster', roles: ['kapster'], expectedPath: '/kapster' },
  { id: 'platform-admin', isPlatformAdmin: true, roles: [], expectedPath: '/pemilik-saas' },
]

const failures = []
function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(label)
}

function membership(roles) {
  return {
    membership_id: MEMBERSHIP_ID,
    tenant_id: TENANT_ID,
    tenant_name: 'Salon Contoh',
    roles,
    outlets: [{ id: OUTLET_ID, name: 'Outlet Contoh', timezone: 'Asia/Jakarta' }],
    subscription_status: 'aktif',
    current_period_end: null,
  }
}

function mePayload(roleCase) {
  return {
    user: { id: '88888888-8888-4888-8888-888888888888', email: `${roleCase.id}@kapsflow.test`, username: roleCase.id },
    is_platform_admin: roleCase.isPlatformAdmin ?? false,
    memberships: roleCase.roles.length ? [membership(roleCase.roles)] : [],
  }
}

async function mockLogin(route, roleCase) {
  const request = route.request()
  const pathname = new URL(request.url()).pathname
  if (request.method() === 'POST' && pathname === '/v1/auth/login') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    return
  }
  if (request.method() === 'GET' && pathname === '/v1/me') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mePayload(roleCase)) })
    return
  }
  await mockApi(route, { ...guestScenario, role: roleCase.id === 'pelanggan' ? 'customer' : 'guest' })
}

async function openLogin(browser, path, roleCase, from) {
  const scenario = { ...guestScenario, path }
  const { context, page } = await openScenario(browser, scenario, { width: 390, height: 844 })
  await page.unroute('**/v1/**')
  await page.route('**/v1/**', (route) => mockLogin(route, roleCase))
  if (from) {
    await page.addInitScript((destination) => {
      window.history.replaceState({ usr: { from: destination }, key: 'login-return', idx: 0 }, '', window.location.href)
    }, from)
  }
  await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.getByRole('heading', { name: 'Masuk ke Trimwait' }).waitFor({ state: 'visible', timeout: 20_000 })
  return { context, page }
}

const stopServers = await startServers()
const browser = await launchChromium()
try {
  const defaultPage = await openLogin(browser, '/masuk', { id: 'owner', roles: ['owner'] })
  const toggleCount = await defaultPage.page.getByRole('group', { name: 'Pilih jenis akun' }).count()
  const hasLoginToggle = toggleCount > 0
  check('Tidak ada toggle Mitra/Pelanggan di /masuk', !hasLoginToggle, `ditemukan ${toggleCount}`)
  const hasSaaSWord = /SaaS/i.test(await defaultPage.page.locator('body').innerText())
  check('Tidak ada jargon SaaS di /masuk', !hasSaaSWord)
  await defaultPage.context.close()

  for (const roleCase of testRoles) {
    const { context, page } = await openLogin(browser, '/masuk', roleCase)
    await page.getByLabel('Email').fill(`${roleCase.id}@kapsflow.test`)
    await page.locator('input[name="password"]').fill('kata-sandi-tiruan')
    await page.getByRole('button', { name: 'Masuk', exact: true }).click()
    await page.waitForURL((url) => url.pathname === roleCase.expectedPath, { timeout: 20_000 })
    const passed = new URL(page.url()).pathname === roleCase.expectedPath
    check(`Redirect ${roleCase.id}`, passed, new URL(page.url()).pathname)
    await context.close()
  }

  const customerRole = { id: 'pelanggan', roles: [] }
  const customer = await openLogin(browser, '/pelanggan/masuk', customerRole, '/o/contoh-barber')
  await customer.page.getByLabel('Email').fill('pelanggan@kapsflow.test')
  await customer.page.locator('input[name="password"]').fill('kata-sandi-tiruan')
  await customer.page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await customer.page.waitForURL((url) => url.pathname === '/o/contoh-barber', { timeout: 20_000 })
  const customerPath = new URL(customer.page.url()).pathname
  check('Redirect pelanggan kembali ke halaman outlet dari state.from', customerPath === '/o/contoh-barber', customerPath)
  await customer.context.close()

  if (failures.length === 0) {
    const outputDir = path.join(ROOT_DIR, 'frontend/ui-review/after')
    await mkdir(outputDir, { recursive: true })
    for (const [id, pathValue, roleCase, from] of [
      ['mitra', '/masuk', { id: 'owner', roles: ['owner'] }, undefined],
      ['pelanggan', '/pelanggan/masuk', customerRole, '/o/contoh-barber'],
    ]) {
      const { context, page } = await openLogin(browser, pathValue, roleCase, from)
      await page.screenshot({ path: path.join(outputDir, `login-${id}-390.png`), fullPage: true })
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.screenshot({ path: path.join(outputDir, `login-${id}-1440.png`), fullPage: true })
      await context.close()
    }
    console.log('PASS Screenshot login mitra dan pelanggan 390px/1440px tersimpan')
  }

  if (failures.length) {
    console.error(`\n${failures.length} pemeriksaan gagal: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('\nSemua pemeriksaan login lulus.')
  }
} finally {
  await browser.close()
  await stopServers()
}
