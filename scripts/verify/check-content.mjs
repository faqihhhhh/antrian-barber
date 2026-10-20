import { readFile, readdir, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ROOT_DIR, WEBSITE_URL, VIEWPORTS, launchChromium } from './browser-fixtures.mjs'

const findings = []
const pass = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) findings.push(label)
}

const pageSource = await readFile(path.join(ROOT_DIR, 'website/src/pages/index.astro'), 'utf8')
const sourceFiles = []
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(filePath)
    else sourceFiles.push(filePath)
  }
}
await Promise.all(['website/src', 'frontend/src'].map((directory) => collect(path.join(ROOT_DIR, directory))))
const typoMatches = []
for (const filePath of sourceFiles) {
  const source = await readFile(filePath, 'utf8')
  if (/antreean|Pesan antreau/i.test(source)) typoMatches.push(path.relative(ROOT_DIR, filePath))
}
pass('Tidak ada typo antrean yang dilarang', typoMatches.length === 0, typoMatches.join(', '))

const todoRequired = ['PAKET', 'HARGA', 'TESTIMONI']
const placeholdersInSource = todoRequired.every((label) => pageSource.includes(`[${label}: isi oleh pemilik]`))
const ownerComments = [...pageSource.matchAll(/<!--\s*TODO pemilik:[\s\S]*?-->/g)].length
pass('Placeholder paket, harga, testimoni dan komentar TODO pemilik tersedia', placeholdersInSource && ownerComments >= 3, `${ownerComments} komentar TODO`)
pass('Tautan demo memakai placeholder kontak', pageSource.includes('mailto:[EMAIL: isi oleh pemilik]') && /TODO pemilik:[^>]*email/i.test(pageSource))

const browser = await launchChromium()
try {
  const context = await browser.newContext({ viewport: VIEWPORTS[0], deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(`${WEBSITE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.locator('main h1').waitFor({ state: 'visible', timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)

  const signupLabels = await page.locator('a[href$="/daftar"]').evaluateAll((links) => links.map((link) => {
    const clone = link.cloneNode(true)
    clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
    return clone.innerText.replace(/\s+/g, ' ').trim()
  }))
  const uniqueLabels = [...new Set(signupLabels)]
  pass('Semua tombol daftar memakai satu label', uniqueLabels.length === 1 && uniqueLabels[0] === 'Buat akun', uniqueLabels.join(' | '))

  const numbers = await page.locator('#cara-kerja [data-step-number]').allTextContents()
  const normalizedNumbers = numbers.map((number) => number.trim())
  const stepTexts = await page.locator('#cara-kerja [data-step-number]').evaluateAll((nodes) => nodes.map((node) => node.parentElement.innerText.replace(/\s+/g, ' ').trim()))
  const expectedSteps = [
    'Pelanggan scan QR atau buka tautan outlet',
    'Pelanggan pilih tanggal dan bayar DP lewat QRIS',
    'Tim memanggil pelanggan sesuai urutan',
  ]
  const workflowOk = normalizedNumbers.join(',') === '01,02,03' && expectedSteps.every((step, index) => stepTexts[index]?.includes(step))
  pass('Cara kerja berisi tiga langkah bernomor berurutan', workflowOk, normalizedNumbers.join(', '))

  const placeholdersVisible = await page.locator('body').innerText()
  pass('Placeholder harga/testimoni tampil di halaman', todoRequired.every((label) => placeholdersVisible.includes(`[${label}: isi oleh pemilik]`)))
  pass('Demo mengarah ke placeholder email', await page.locator('a[href="mailto:[EMAIL: isi oleh pemilik]"]').count() === 1)

  const screenshotsDir = path.join(ROOT_DIR, 'frontend/ui-review/after')
  await mkdir(screenshotsDir, { recursive: true })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await page.screenshot({ path: path.join(screenshotsDir, `content-website-home-${viewport.width}.png`), fullPage: true })
  }
  await context.close()
} finally {
  await browser.close()
}

if (findings.length) {
  console.error(`\n${findings.length} pemeriksaan gagal.`)
  process.exitCode = 1
} else {
  console.log('\nSemua pemeriksaan konten lulus.')
}
