import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERIFY_DIR = path.dirname(fileURLToPath(import.meta.url))
export const ROOT_DIR = path.resolve(VERIFY_DIR, '../..')
export const BEFORE_DIR = path.join(ROOT_DIR, 'frontend', 'ui-review', 'before')
export const OUTPUT_DIR = path.join(VERIFY_DIR, 'out')
export const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173'
export const WEBSITE_URL = process.env.WEBSITE_URL || 'http://127.0.0.1:4321'
export const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]

export const TENANT_ID = '11111111-1111-4111-8111-111111111111'
export const OUTLET_ID = '22222222-2222-4222-8222-222222222222'
export const SESSION_ID = '33333333-3333-4333-8333-333333333333'
export const TICKET_ID = '44444444-4444-4444-8444-444444444444'
export const MEMBERSHIP_ID = '55555555-5555-4555-8555-555555555555'

export const SCENARIOS = [
  { id: 'website-home', kind: 'website', path: '/' },
  { id: 'website-syarat', kind: 'website', path: '/syarat' },
  { id: 'website-privasi', kind: 'website', path: '/privasi' },
  { id: 'app-masuk', kind: 'app', path: '/masuk', role: 'guest' },
  { id: 'app-outlet-contoh-barber', kind: 'app', path: '/o/contoh-barber', role: 'guest' },
  { id: 'app-tiket-waiting', kind: 'app', path: `/tiket/${TICKET_ID}`, role: 'customer' },
  { id: 'app-kapster', kind: 'app', path: '/kapster', role: 'kapster' },
  { id: 'app-admin-kelola', kind: 'app', path: `/kelola/${TENANT_ID}/${OUTLET_ID}`, role: 'admin' },
]

const sessionDate = new Date().toISOString().slice(0, 10)
const timestamp = new Date().toISOString()

const outletInfo = { id: OUTLET_ID, name: 'Salon Cabang Utama', timezone: 'Asia/Jakarta' }

const queueSession = {
  id: SESSION_ID,
  outlet_id: OUTLET_ID,
  session_date: sessionDate,
  max_quota: 20,
  used_quota: 6,
  status: 'open',
  created_at: timestamp,
  updated_at: timestamp,
}

const queueTickets = [
  { id: TICKET_ID, ticket_number: 4, queue_position: 4, channel: 'online', customer_name: 'Raka Pratama', match_code: 'A7K2Q9', status: 'waiting' },
  { id: '66666666-6666-4666-8666-666666666666', ticket_number: 5, queue_position: 5, channel: 'offline', customer_name: 'Dimas', match_code: '', status: 'waiting' },
  { id: '77777777-7777-4777-8777-777777777777', ticket_number: 6, queue_position: 6, channel: 'online', customer_name: 'Adi Saputra', match_code: 'B5M3R8', status: 'waiting' },
]

const myTicket = {
  ticket_id: TICKET_ID,
  tenant_id: TENANT_ID,
  outlet_id: OUTLET_ID,
  outlet_name: 'Salon Cabang Utama',
  outlet_slug: 'contoh-barber',
  outlet_timezone: 'Asia/Jakarta',
  session_id: SESSION_ID,
  session_date: sessionDate,
  ticket_number: 4,
  status: 'waiting',
  match_code: 'A7K2Q9',
  customer_name: 'Raka Pratama',
  payment: null,
  estimate: { tickets_ahead: 3, active_kapsters: 2, estimated_wait_minutes: 30 },
  reviewed: false,
}

function membership(role) {
  return {
    membership_id: MEMBERSHIP_ID,
    tenant_id: TENANT_ID,
    tenant_name: 'Salon Cantik Selalu',
    roles: [role],
    outlets: [outletInfo],
    subscription_status: 'aktif',
    current_period_end: null,
  }
}

function meFor(role) {
  const roles = role === 'kapster' || role === 'admin' ? [membership(role)] : []
  return {
    user: { id: '88888888-8888-4888-8888-888888888888', email: 'demo@kapsflow.test', username: 'demo_kapsflow' },
    is_platform_admin: false,
    memberships: roles,
  }
}

function outletPage() {
  const start = new Date(`${sessionDate}T00:00:00.000Z`)
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + index)
    const value = date.toISOString().slice(0, 10)
    const today = index === 0
    return {
      date: value,
      session_id: today ? SESSION_ID : null,
      open: today,
      max_quota: today ? 20 : 0,
      remaining: today ? 14 : 0,
    }
  })
  return {
    outlet_id: OUTLET_ID,
    tenant_id: TENANT_ID,
    slug: 'contoh-barber',
    business_name: 'Salon Cantik Selalu',
    outlet_name: 'Salon Cabang Utama',
    address: 'Jl. Melati No. 10, Jakarta',
    timezone: 'Asia/Jakarta',
    local_today: sessionDate,
    dp_price_rupiah: 25000,
    default_duration_minutes: 30,
    payment_mode: 'manual',
    accepting_bookings: true,
    unavailable_reason: null,
    days,
    today: { session_id: SESSION_ID, status: 'open', waiting_count: 4, active_kapsters: 2, estimated_wait_minutes: 30, updated_at: timestamp },
  }
}

function jsonResponse(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  })
}

export async function mockApi(route, scenario) {
  const request = route.request()
  const { pathname } = new URL(request.url())
  const method = request.method()

  if (method === 'GET' && pathname === '/v1/me') {
    if (scenario.role === 'guest') return jsonResponse(route, { error: { code: 'belum_login', message: 'Anda belum masuk' } }, 401)
    return jsonResponse(route, meFor(scenario.role))
  }
  if (method === 'GET' && pathname === '/v1/me/tickets') {
    return jsonResponse(route, scenario.role === 'customer' ? [myTicket] : [])
  }
  if (method === 'GET' && pathname === '/v1/public/outlets/contoh-barber') {
    return jsonResponse(route, outletPage())
  }
  if (method === 'GET' && pathname === '/v1/public/outlets') {
    return jsonResponse(route, [
      { business_name: 'Salon Cantik Selalu', outlet_name: 'Salon Cabang Utama', slug: 'contoh-barber' },
      { business_name: 'Barber Contoh', outlet_name: 'Cabang Selatan', slug: 'barber-contoh-selatan' },
    ])
  }
  if (method === 'GET' && /\/outlets\/[0-9a-f-]+\/queue-sessions$/.test(pathname)) {
    return jsonResponse(route, [queueSession])
  }
  if (method === 'GET' && /\/queue-sessions\/[0-9a-f-]+\/tickets$/.test(pathname)) {
    return jsonResponse(route, queueTickets)
  }
  if (method === 'GET' && /\/queue-sessions\/[0-9a-f-]+\/kapster-states$/.test(pathname)) {
    return jsonResponse(route, [{ membership_id: MEMBERSHIP_ID, status: 'idle', current_ticket_id: null }])
  }
  if (method === 'GET' && /\/queue-sessions\/[0-9a-f-]+\/(pending-manual-payments|awaiting-settlement)$/.test(pathname)) {
    return jsonResponse(route, [])
  }
  if (method === 'GET' && pathname === `/v1/tenants/${TENANT_ID}/outlets`) {
    return jsonResponse(route, [{ ...outletInfo, slug: 'contoh-barber', address: 'Jl. Melati No. 10, Jakarta', dp_price_rupiah: 25000, default_duration_minutes: 30 }])
  }
  if (method === 'GET') return jsonResponse(route, [])
  return jsonResponse(route, { message: 'Respons tiruan untuk baseline' })
}

export async function startServers() {
  const started = []
  try {
    await ensureServer(`${APP_URL}/masuk`, 'frontend', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173', '--strictPort'], {
      VITE_APP_URL: APP_URL,
    }, started)
    await ensureServer(`${WEBSITE_URL}/`, 'website', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '4321', '--strictPort'], {
      PUBLIC_APP_URL: APP_URL,
    }, started)
  } catch (error) {
    await stopServers(started)
    throw error
  }
  return () => stopServers(started)
}

async function ensureServer(probeUrl, packageDirectory, args, extraEnv, started) {
  if (await responds(probeUrl)) {
    console.log(`[server] memakai server aktif ${probeUrl}`)
    return
  }
  const cwd = path.join(ROOT_DIR, packageDirectory)
  if (!existsSync(path.join(cwd, 'node_modules'))) {
    throw new Error(`Dependensi belum terpasang di ${packageDirectory}/node_modules`)
  }
  const child = spawn('npm', args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const server = { child, output: '' }
  started.push(server)
  child.stdout.on('data', (chunk) => { server.output = `${server.output}${chunk}`.slice(-8000) })
  child.stderr.on('data', (chunk) => { server.output = `${server.output}${chunk}`.slice(-8000) })
  child.on('error', (error) => { server.error = error })

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await responds(probeUrl)) {
      console.log(`[server] berjalan ${probeUrl}`)
      return
    }
    if (child.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Server ${packageDirectory} tidak siap di ${probeUrl}.\n${server.error?.message ?? server.output}`)
}

async function responds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.status < 500
  } catch {
    return false
  }
}

async function stopServers(servers) {
  for (const { child } of [...servers].reverse()) {
    if (child.exitCode !== null) continue
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
      else child.kill('SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
  await Promise.all(servers.map(({ child }) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    const timer = setTimeout(() => resolve(), 3000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })))
}

export async function launchChromium() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(VERIFY_DIR, '.cache', 'ms-playwright')
  const localLibraryRoot = path.join(VERIFY_DIR, '.cache', 'system-libraries')
  const libraryPaths = [
    path.join(localLibraryRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
    path.join(localLibraryRoot, 'lib', 'x86_64-linux-gnu'),
  ]
  if (existsSync(localLibraryRoot)) {
    process.env.LD_LIBRARY_PATH = [...libraryPaths, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter)
  }
  const { chromium } = await import('playwright')
  return chromium.launch({ headless: true })
}

export async function openScenario(browser, scenario, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  const page = await context.newPage()
  if (scenario.kind === 'app') {
    await page.route('**/v1/**', (route) => mockApi(route, scenario))
    await page.addInitScript(() => {
      class BaselineEventSource {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSED = 2
        readyState = BaselineEventSource.CONNECTING
        onopen = null
        onerror = null
        onmessage = null
        constructor(url) {
          this.url = url
          queueMicrotask(() => {
            this.readyState = BaselineEventSource.OPEN
            this.onopen?.(new Event('open'))
          })
        }
        close() { this.readyState = BaselineEventSource.CLOSED }
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() { return true }
      }
      Object.defineProperty(window, 'EventSource', { configurable: true, writable: true, value: BaselineEventSource })
    })
  }
  return { context, page }
}

export async function waitForScenario(page, scenario) {
  const markers = {
    'website-home': 'Antrian rapi.',
    'website-syarat': 'Syarat',
    'website-privasi': 'Privasi',
    'app-masuk': 'Masuk ke Kapsflow',
    'app-outlet-contoh-barber': 'Salon Cabang Utama',
    'app-tiket-waiting': 'Pembayaran diterima. Anda sudah masuk antrian.',
    'app-kapster': 'Meja kapster',
    'app-admin-kelola': 'Meja admin',
  }
  const marker = markers[scenario.id]
  if (marker) await page.getByText(marker, { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(200)
}

export function scenarioUrl(scenario) {
  return `${scenario.kind === 'website' ? WEBSITE_URL : APP_URL}${scenario.path}`
}

export async function uniqueBaselinePath(scenario, width) {
  const { mkdir, access } = await import('node:fs/promises')
  await mkdir(BEFORE_DIR, { recursive: true })
  const base = `before-${scenario.id}-${width}.png`
  const basePath = path.join(BEFORE_DIR, base)
  try {
    await access(basePath)
  } catch {
    return basePath
  }

  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  let suffix = 1
  while (true) {
    const ending = suffix === 1 ? `-baseline-${date}` : `-baseline-${date}-${suffix}`
    const candidate = path.join(BEFORE_DIR, `${base.slice(0, -4)}${ending}.png`)
    try {
      await access(candidate)
      suffix += 1
    } catch {
      return candidate
    }
  }
}
