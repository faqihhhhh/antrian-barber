import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { ROOT_DIR, WEBSITE_URL, launchChromium } from './browser-fixtures.mjs'

const failures = []
const browser = await launchChromium()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await page.goto(`${WEBSITE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.locator('.hero h1').waitFor({ state: 'visible', timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(200)

  const measurements = {}
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.waitForTimeout(100)
    const result = await page.evaluate(() => {
      const hero = document.querySelector('.hero')
      const heading = hero.querySelector('h1')
      const copy = hero.querySelector('.hero-copy')
      const preview = hero.querySelector('.preview-wrap')
      const buttonRects = [
        hero.querySelector('.hero-actions .button')?.getBoundingClientRect(),
        document.querySelector('.closing-cta .button')?.getBoundingClientRect(),
      ]
      const css = getComputedStyle(hero)
      const paddingTop = Number.parseFloat(css.paddingTop) || 0
      const paddingBottom = Number.parseFloat(css.paddingBottom) || 0
      const rowGap = Number.parseFloat(css.rowGap) || 0
      const copyHeight = copy.getBoundingClientRect().height
      const previewHeight = preview.getBoundingClientRect().height
      const contentRowsHeight = window.innerWidth <= 680 ? copyHeight + previewHeight + rowGap : Math.max(copyHeight, previewHeight)
      const contentHeight = paddingTop + contentRowsHeight + paddingBottom
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        heroHeight: hero.getBoundingClientRect().height,
        heroContentHeight: contentHeight,
        heroRatio: hero.getBoundingClientRect().height / contentHeight,
        headingLetterSpacing: getComputedStyle(heading).letterSpacing,
        primaryButtonHeights: buttonRects.map((rect) => rect?.height ?? null),
      }
    })
    measurements[width] = result
    console.log(`MEASURE ${width}px ${JSON.stringify(result)}`)
  }

  const mobile = measurements[390]
  const desktop = measurements[1440]
  const check = (label, passed, detail = '') => {
    console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
    if (!passed) failures.push(label)
  }
  check('Tidak ada overflow horizontal pada viewport 390px', mobile.documentWidth === 390 && mobile.bodyWidth === mobile.bodyClientWidth, `document ${mobile.documentWidth}, body ${mobile.bodyWidth}/${mobile.bodyClientWidth}`)
  check('Tinggi hero mobile tidak melebihi 1,25x konten', mobile.heroRatio <= 1.25, `rasio ${mobile.heroRatio.toFixed(3)}`)
  check('Tombol utama hero dan penutup minimal 44px pada 390px', mobile.primaryButtonHeights.every((height) => height !== null && height >= 44), mobile.primaryButtonHeights.map((height) => `${height}px`).join(', '))
  check('Letter-spacing h1 mobile cukup longgar', Number.parseFloat(mobile.headingLetterSpacing) >= -0.5, mobile.headingLetterSpacing)
  check('Letter-spacing h1 desktop cukup longgar', Number.parseFloat(desktop.headingLetterSpacing) >= -1.5, desktop.headingLetterSpacing)

  const screenshotDir = path.join(ROOT_DIR, 'frontend/ui-review/after')
  await mkdir(screenshotDir, { recursive: true })
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.screenshot({ path: path.join(screenshotDir, `website-hero-${width}.png`), fullPage: true })
  }
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\n${failures.length} pemeriksaan gagal.`)
  process.exitCode = 1
} else {
  console.log('\nSemua pemeriksaan responsif lulus.')
}
