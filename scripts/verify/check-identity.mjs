import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const verifyDir = path.dirname(fileURLToPath(import.meta.url))
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(verifyDir, '.cache', 'ms-playwright')
const localLibraries = path.join(verifyDir, '.cache', 'system-libraries', 'usr', 'lib', 'x86_64-linux-gnu')
process.env.LD_LIBRARY_PATH = [localLibraries, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter)
const { chromium } = await import('playwright')
const websiteUrl = process.env.WEBSITE_URL ?? 'http://127.0.0.1:4321'
const screenshotDirectory = path.join(root, 'frontend', 'ui-review', 'after')
const websiteSource = await readFile(path.join(root, 'website/src/pages/index.astro'), 'utf8')
const logoSource = await readFile(path.join(root, 'frontend/src/components/Logo.tsx'), 'utf8')
const tokenSource = await readFile(path.join(root, 'frontend/src/index.css'), 'utf8')

const tokenColors = new Set([...tokenSource.matchAll(/--color-[\w-]+:\s*(#[\da-fA-F]{3,8})/g)].map((match) => match[1].toLowerCase()))
const websiteColors = [...new Set([...websiteSource.matchAll(/#[\da-fA-F]{3,8}\b/g)].map((match) => match[0].toLowerCase()))]
const unapprovedColors = websiteColors.filter((color) => !tokenColors.has(color))
assert.deepEqual(unapprovedColors, [], `Warna index.astro di luar token frontend: ${unapprovedColors.join(', ')}`)

const logoPaths = (source) => [...source.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1])
const expectedLogoPaths = logoPaths(logoSource)
assert.ok(expectedLogoPaths.length > 0, 'Logo.tsx tidak memiliki path SVG untuk dibandingkan')

const browser = await chromium.launch({ headless: true })
const failures = []
const viewports = [{ width: 390, height: 844 }, { width: 1440, height: 900 }]
await mkdir(screenshotDirectory, { recursive: true })
try {
  for (const [route, id] of [['/', 'website-home'], ['/syarat', 'website-syarat'], ['/privasi', 'website-privasi']]) {
    const page = await browser.newPage({ viewport: viewports[0] })
    const response = await page.goto(new URL(route, websiteUrl).toString(), { waitUntil: 'networkidle' })
    assert.ok(response?.ok(), `${route} membalas HTTP ${response?.status() ?? 'tanpa respons'}`)
    const head = await page.evaluate(() => ({
      icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null,
      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null,
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null,
      ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? null,
      ogType: document.querySelector('meta[property="og:type"]')?.getAttribute('content') ?? null,
      ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
      twitterCard: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? null,
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    }))
    if (!head.icon) failures.push(`${route}: link rel="icon" tidak ditemukan`)
    if (!head.ogImage) failures.push(`${route}: meta og:image tidak ditemukan`)
    for (const property of ['ogTitle', 'ogDescription', 'ogType', 'ogUrl', 'twitterCard']) {
      if (!head[property]) failures.push(`${route}: ${property} tidak ditemukan`)
    }
    if (head.themeColor?.toLowerCase() !== '#faf7f2') failures.push(`${route}: theme-color bukan #faf7f2`)
    if (head.icon) {
      const iconResponse = await page.request.get(new URL(head.icon, websiteUrl).toString())
      if (!iconResponse.ok()) failures.push(`${route}: favicon tidak dapat dimuat (${iconResponse.status()})`)
    }
    if (head.ogImage) {
      const imageResponse = await page.request.get(new URL(head.ogImage, websiteUrl).toString())
      if (!imageResponse.ok()) failures.push(`${route}: og:image tidak dapat dimuat (${imageResponse.status()})`)
    }

    const pageLogoPaths = await page.locator('a.brand svg path').evaluateAll((paths) => paths.map((element) => element.getAttribute('d')))
    if (pageLogoPaths.length === 0 || pageLogoPaths.some((path) => path !== expectedLogoPaths[0])) {
      failures.push(`${route}: path SVG logo tidak sama dengan frontend/src/components/Logo.tsx`)
    }
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.screenshot({ path: path.join(screenshotDirectory, `before-${id}-${viewport.width}.png`) })
    }
    await page.close()
  }
} finally {
  await browser.close()
}

assert.deepEqual(failures, [], failures.join('\n'))
console.log('PASS: warna website memakai token, favicon/og:image tersedia, dan path logo sama.')
