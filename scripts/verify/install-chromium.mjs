import { spawnSync } from 'node:child_process'
import { mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const directory = path.dirname(fileURLToPath(import.meta.url))
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(directory, '.cache', 'ms-playwright')

const result = spawnSync(
  process.execPath,
  [path.join(directory, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'],
  { cwd: directory, env: process.env, stdio: 'inherit' },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const { chromium } = await import('playwright')
const browserPath = chromium.executablePath()
const dependencyCheck = spawnSync('ldd', [browserPath], { encoding: 'utf8' })
const missingLibraries = [...(dependencyCheck.stdout ?? '').matchAll(/^\s*(\S+)\s+=> not found$/gm)].map((match) => match[1])
if (missingLibraries.length === 0) process.exit(0)

const soundPolicy = spawnSync('apt-cache', ['policy', 'libasound2t64'], { encoding: 'utf8' })
const soundPackage = /Candidate:\s+\(none\)/.test(soundPolicy.stdout ?? '') ? 'libasound2' : 'libasound2t64'
const downloadDirectory = path.join(directory, '.cache', 'system-library-debs')
const extractionDirectory = path.join(directory, '.cache', 'system-libraries')
await mkdir(downloadDirectory, { recursive: true })
await mkdir(extractionDirectory, { recursive: true })

const download = spawnSync('apt-get', ['download', 'libnspr4', 'libnss3', soundPackage], {
  cwd: downloadDirectory,
  encoding: 'utf8',
  stdio: 'inherit',
})
if (download.error) throw download.error
if (download.status !== 0) throw new Error('Gagal mengunduh pustaka runtime Chromium lewat apt-get download.')

for (const file of await readdir(downloadDirectory)) {
  if (!file.endsWith('.deb')) continue
  const extract = spawnSync('dpkg-deb', ['-x', path.join(downloadDirectory, file), extractionDirectory], { stdio: 'inherit' })
  if (extract.error) throw extract.error
  if (extract.status !== 0) throw new Error(`Gagal mengekstrak pustaka ${file}.`)
}

console.log(`Pustaka Chromium disiapkan lokal untuk: ${missingLibraries.join(', ')}`)
