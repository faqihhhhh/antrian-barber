import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  OUTPUT_DIR,
  SCENARIOS,
  VIEWPORTS,
  launchChromium,
  openScenario,
  scenarioUrl,
  startServers,
  waitForScenario,
} from './browser-fixtures.mjs'

const FONT_SIZE_LIMIT_PX = 12
const CONTRAST_LIMIT = 4.5
const stopServers = await startServers()
let browser

try {
  browser = await launchChromium()
  await mkdir(OUTPUT_DIR, { recursive: true })
  const pages = []

  for (const scenario of SCENARIOS) {
    for (const viewport of VIEWPORTS) {
      const { context, page } = await openScenario(browser, scenario, viewport)
      try {
        await page.goto(scenarioUrl(scenario), { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await waitForScenario(page, scenario)
        if (scenario.id === 'website-home') {
          await page.frameLocator('iframe').getByText('Masuk ke Trimwait', { exact: false }).waitFor({ state: 'visible', timeout: 20_000 })
        }

        const frameResults = []
        for (const frame of page.frames()) {
          const findings = await frame.evaluate(({ fontLimit, contrastLimit }) => {
            const parseColor = (value) => {
              const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i)
              if (!match) return null
              return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) }
            }
            const composite = (front, back) => ({
              r: front.r * front.a + back.r * (1 - front.a),
              g: front.g * front.a + back.g * (1 - front.a),
              b: front.b * front.a + back.b * (1 - front.a),
              a: 1,
            })
            const linear = (channel) => {
              const value = channel / 255
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
            }
            const luminance = ({ r, g, b }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
            const ratio = (one, two) => {
              const first = luminance(one)
              const second = luminance(two)
              return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
            }
            const visible = (element) => {
              const style = getComputedStyle(element)
              const rect = element.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
            }
            const directText = (element) => [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent ?? '')
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
            const selectorFor = (element) => {
              const classes = typeof element.className === 'string'
                ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((name) => `.${name}`).join('')
                : ''
              return `${element.tagName.toLowerCase()}${classes}`
            }
            const backgroundFor = (element) => {
              const ancestors = []
              for (let current = element; current; current = current.parentElement) ancestors.push(current)
              let background = { r: 255, g: 255, b: 255, a: 1 }
              for (const ancestor of ancestors.reverse()) {
                const color = parseColor(getComputedStyle(ancestor).backgroundColor)
                if (color && color.a > 0) background = composite(color, background)
              }
              return background
            }

            const smallFonts = []
            const lowContrast = []
            const elements = document.querySelectorAll('body *')
            for (const element of elements) {
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(element.tagName) || !visible(element)) continue
              const text = directText(element)
              if (!text) continue
              const style = getComputedStyle(element)
              const fontSize = Number.parseFloat(style.fontSize)
              const record = { selector: selectorFor(element), text: text.slice(0, 120), fontSizePx: Math.round(fontSize * 100) / 100 }
              if (fontSize < fontLimit) smallFonts.push(record)

              const foreground = parseColor(style.color)
              if (!foreground) continue
              const background = backgroundFor(element)
              const paintedForeground = composite(foreground, background)
              const contrast = ratio(paintedForeground, background)
              if (contrast < contrastLimit) {
                lowContrast.push({
                  ...record,
                  foreground: style.color,
                  effectiveBackground: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
                  contrastRatio: Math.round(contrast * 100) / 100,
                })
              }
            }
            return { url: location.href, smallFonts, lowContrast }
          }, { fontLimit: FONT_SIZE_LIMIT_PX, contrastLimit: CONTRAST_LIMIT })
          frameResults.push(findings)
        }

        const smallFonts = frameResults.flatMap((frame) => frame.smallFonts.map((finding) => ({ ...finding, frame: frame.url })))
        const lowContrast = frameResults.flatMap((frame) => frame.lowContrast.map((finding) => ({ ...finding, frame: frame.url })))
        const result = {
          id: scenario.id,
          path: scenario.path,
          kind: scenario.kind,
          viewport,
          fontSizeBelow12px: { count: smallFonts.length, elements: smallFonts },
          contrastBelow4_5: { count: lowContrast.length, elements: lowContrast },
        }
        pages.push(result)
        console.log(`PAGE ${scenario.id} ${viewport.width}x${viewport.height} | font < 12px: ${smallFonts.length} | kontras < 4,5:1: ${lowContrast.length}`)
        for (const finding of smallFonts) {
          console.log(`  FONT ${finding.fontSizePx}px ${finding.selector} “${finding.text}”`)
        }
        for (const finding of lowContrast) {
          console.log(`  CONTRAST ${finding.contrastRatio}:1 ${finding.selector} “${finding.text}” (${finding.foreground} / ${finding.effectiveBackground})`)
        }
      } finally {
        await context.close()
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      fontSizeBelowPx: FONT_SIZE_LIMIT_PX,
      contrastBelow: CONTRAST_LIMIT,
    },
    method: 'Elemen dengan teks langsung yang terlihat diperiksa dari computed font-size, warna teks, dan warna latar computed yang dikompositkan terhadap putih. Gambar latar, text-shadow, dan piksel anti-alias tidak dihitung.',
    pages,
  }
  const outputPath = path.join(OUTPUT_DIR, 'baseline.json')
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`SAVED ${path.relative(process.cwd(), outputPath)}`)
} finally {
  await browser?.close()
  await stopServers()
}
