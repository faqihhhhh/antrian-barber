import { spawnSync } from 'node:child_process'
import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outputDirectory = path.dirname(fileURLToPath(import.meta.url))
const verifyDirectory = path.resolve(outputDirectory, '..')
const outputPath = path.join(outputDirectory, 'final.json')
const scripts = (await readdir(verifyDirectory))
  .filter((name) => name.endsWith('.mjs'))
  .sort()
const results = []
const report = {
  generatedAt: new Date().toISOString(),
  command: 'Menjalankan semua scripts/verify/*.mjs satu per satu dengan Node.js.',
  results,
}

for (const script of scripts) {
  const args = script === 'format.test.mjs'
    ? ['--experimental-strip-types', script]
    : [script]
  const startedAt = Date.now()
  console.log(`\n===== ${script} =====`)
  const child = spawnSync(process.execPath, args, {
    cwd: verifyDirectory,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  })
  const stdout = child.stdout ?? ''
  const stderr = child.stderr ?? ''
  const status = child.status === 0 && !child.error ? 'PASS' : 'FAIL'
  const entry = {
    script,
    command: `${process.execPath} ${args.join(' ')}`,
    status,
    exitCode: child.status,
    durationMs: Date.now() - startedAt,
    stdout,
    stderr,
    error: child.error?.message ?? null,
  }
  results.push(entry)
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  if (child.error) console.error(child.error.message)
  console.log(`RESULT ${script}: ${status}`)
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
}

console.log(`\nSAVED ${outputPath}`)
if (results.some(({ status }) => status !== 'PASS')) process.exitCode = 1
