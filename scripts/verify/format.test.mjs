import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dayOfMonth,
  formatLongDate,
  formatMonthYear,
  weekdayShort,
} from '../../frontend/src/lib/format.ts'

test('format tanggal lokal menampilkan hari dan bulan dalam bahasa Indonesia', () => {
  assert.equal(formatLongDate('2026-10-19'), 'Senin, 19 Oktober 2026')
  assert.equal(weekdayShort('2026-10-19'), 'Sen')
  assert.equal(dayOfMonth('2026-10-19'), '19')
  assert.equal(formatMonthYear('2026-10-19'), 'Okt 2026')
})

test('format tanggal dan bulan November tidak bergeser', () => {
  assert.equal(dayOfMonth('2026-11-01'), '1')
  assert.equal(formatMonthYear('2026-11-01'), 'Nov 2026')
})

test('tanggal dengan format salah tidak menghasilkan Invalid Date', () => {
  assert.equal(formatLongDate('bukan-tanggal'), '')
  assert.equal(formatMonthYear('bukan-tanggal'), '')
  assert.equal(weekdayShort('bukan-tanggal'), '')
  assert.equal(dayOfMonth('bukan-tanggal'), '')
})

test('tanggal kalender yang tidak ada ditolak', () => {
  assert.equal(dayOfMonth('2026-02-30'), '')
})
