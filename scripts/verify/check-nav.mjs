import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import {
  ROOT_DIR,
  SCENARIOS,
  launchChromium,
  mockApi,
  openScenario,
  scenarioUrl,
  startServers,
} from './browser-fixtures.mjs'

const adminScenario = SCENARIOS.find(({ id }) => id === 'app-admin-kelola')
const kapsterScenario = SCENARIOS.find(({ id }) => id === 'app-kapster')
const customerScenario = SCENARIOS.find(({ id }) => id === 'app-tiket-waiting')
if (!adminScenario || !kapsterScenario || !customerScenario) throw new Error('Fixture role tidak lengkap')

const cases = [
  { id: 'owner-admin', path: '/akun', scenario: adminScenario, roles: ['owner', 'admin'] },
  { id: 'owner', path: '/akun', scenario: adminScenario, roles: ['owner'] },
  { id: 'admin', path: '/akun', scenario: adminScenario, roles: ['admin'] },
  { id: 'kapster', path: '/kapster', scenario: kapsterScenario, roles: ['kapster'] },
  { id: 'pelanggan', path: '/pelanggan', scenario: customerScenario, roles: [] },
]

const failures = []
function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures.push(label)
}

async function mockRole(route, scenario, roles) {
  const request = route.request()
  let options
  await mockApi({ request: () => request, fulfill: (value) => { options = value; return Promise.resolve() } }, scenario)
  const pathname = new URL(request.url()).pathname
  if (request.method() === 'GET' && pathname === '/v1/me' && roles.length > 0) {
    const payload = JSON.parse(options.body)
    if (payload.memberships[0]) payload.memberships[0].roles = roles
    options.body = JSON.stringify(payload)
  }
  await route.fulfill(options)
}

const stopServers = await startServers()
const browser = await launchChromium()
try {
  const pages = []
  let allPassed = true
  for (const roleCase of cases) {
    const { context, page } = await openScenario(browser, { ...roleCase.scenario, path: roleCase.path }, { width: 390, height: 844 })
    pages.push({ context, page, roleCase })
    await page.unroute('**/v1/**')
    await page.route('**/v1/**', (route) => mockRole(route, roleCase.scenario, roleCase.roles))
    await page.goto(scenarioUrl({ ...roleCase.scenario, path: roleCase.path }), { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.locator('header.sticky').waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('nav[aria-label="Menu ruang"]').last().waitFor({ state: 'visible', timeout: 20_000 })

    const visibleWorkspaceNavCount = await page.locator('nav[aria-label="Pindah ruang"], nav[aria-label="Menu ruang"]').evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }).length)
    const navPassed = visibleWorkspaceNavCount <= 1
    check(`${roleCase.id}: satu bar navigasi terlihat di 390px`, navPassed, `jumlah nav ${visibleWorkspaceNavCount}`)
    allPassed &&= navPassed

    const navLabels = await page.locator('nav[aria-label="Menu ruang"]').last().locator('a').allTextContents()
    const accountLastPassed = navLabels.at(-1)?.trim() === 'Akun'
    check(`${roleCase.id}: Akun berada paling kanan`, accountLastPassed, navLabels.map((label) => label.trim()).join(' → '))
    allPassed &&= accountLastPassed

    const dockHeight = await page.locator('nav[aria-label="Menu ruang"]').last().evaluate((nav) => nav.parentElement.getBoundingClientRect().height)
    const dockHeightPassed = dockHeight <= 64
    check(`${roleCase.id}: tinggi bar bawah maksimal 4rem`, dockHeightPassed, `${dockHeight}px`)
    allPassed &&= dockHeightPassed

    if (roleCase.id === 'kapster') {
      const shellPadding = await page.locator('header.sticky').evaluate((header) => Number.parseFloat(getComputedStyle(header.parentElement).paddingBottom))
      const paddingPassed = shellPadding <= 64
      check('kapster: padding bawah shell maksimal 4rem', paddingPassed, `${shellPadding}px`)
      allPassed &&= paddingPassed
    }

    if (roleCase.id === 'owner-admin') {
      const trigger = page.getByRole('button', { name: /Pindah ruang|Pilih ruang/ })
      const hasTrigger = await trigger.count() === 1
      let canOpen = false
      let canCloseWithEscape = false
      let expandedAfterEnter = 'tombol tidak ada'
      let workspaceOptionsVisible = false
      if (hasTrigger) {
        await trigger.focus()
        await page.keyboard.press('Enter')
        expandedAfterEnter = await trigger.getAttribute('aria-expanded') ?? 'tidak ada'
        canOpen = expandedAfterEnter === 'true'
        const menuText = await page.locator('#mobile-workspace-menu').innerText().catch(() => '')
        workspaceOptionsVisible = menuText.includes('Owner') && menuText.includes('Admin')
        await page.keyboard.press('Escape')
        canCloseWithEscape = await trigger.getAttribute('aria-expanded') === 'false' && await trigger.evaluate((element) => document.activeElement === element)
      }
      check('owner+admin: dropdown ruang dapat dibuka dengan Enter', canOpen, `aria-expanded=${expandedAfterEnter}`)
      check('owner+admin: dropdown memuat workspace yang tersedia', workspaceOptionsVisible)
      check('owner+admin: dropdown dapat ditutup dengan Esc dan fokus kembali', canCloseWithEscape)
      allPassed &&= hasTrigger && canOpen && workspaceOptionsVisible && canCloseWithEscape
    }
  }

  if (allPassed) {
    const outputDir = path.join(ROOT_DIR, 'frontend/ui-review/after')
    await mkdir(outputDir, { recursive: true })
    for (const { page, roleCase } of pages) {
      await page.screenshot({ path: path.join(outputDir, `nav-${roleCase.id}-390.png`), fullPage: true })
    }
    console.log('PASS Tangkapan layar 390px untuk owner+admin, owner, admin, kapster, dan pelanggan tersimpan')
  }

  for (const { context } of pages) await context.close()
  if (failures.length) {
    console.error(`\n${failures.length} pemeriksaan gagal: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log('\nSemua pemeriksaan navigasi lulus.')
  }
} finally {
  await browser.close()
  await stopServers()
}
