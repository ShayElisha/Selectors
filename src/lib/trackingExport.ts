import type { Lane, Worker } from '../types'
import type { WorkerLaneStats } from '../algorithm'

/** Escape a CSV cell (Excel-friendly, UTF-8) */
function csvCell(value: string | number): string {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Build a worker×lane matrix CSV that Excel opens with Hebrew correctly (UTF-8 BOM).
 */
export function buildTrackingCsv(
  workers: Worker[],
  lanes: Lane[],
  statsByWorker: Map<string, WorkerLaneStats>,
  options?: { fromDate?: string; toDate?: string },
): string {
  const header = [
    'בודק',
    ...lanes.map((l) => l.name),
    'קל יום',
    'קל לילה',
    'בינוני',
    'קשה',
    'עומס אפקטיבי',
    'סה״כ',
  ]

  const rows = workers.map((w) => {
    const s = statsByWorker.get(w.id)
    return [
      w.fullName,
      ...lanes.map((l) => s?.byLane[l.id] ?? 0),
      s?.dayEasyCount ?? 0,
      s?.nightEasyCount ?? 0,
      s?.mediumCount ?? 0,
      s?.hardCount ?? 0,
      s?.effectiveLoad ?? 0,
      s?.totalAssignments ?? 0,
    ]
  })

  const meta: string[] = ['מעקב נתיבים — שיבוצון']
  if (options?.fromDate || options?.toDate) {
    meta.push(
      `טווח: ${options.fromDate || 'התחלה'} עד ${options.toDate || 'היום'}`,
    )
  } else {
    meta.push('טווח: כל ההיסטוריה')
  }
  meta.push(`הופק: ${new Date().toLocaleString('he-IL')}`)

  const lines = [
    meta.map(csvCell).join(','),
    '',
    header.map(csvCell).join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
  ]

  return `\uFEFF${lines.join('\r\n')}`
}

export function downloadTrackingExcel(
  workers: Worker[],
  lanes: Lane[],
  statsByWorker: Map<string, WorkerLaneStats>,
  options?: { fromDate?: string; toDate?: string },
): void {
  const csv = buildTrackingCsv(workers, lanes, statsByWorker, options)
  const from = options?.fromDate || 'all'
  const to = options?.toDate || 'now'
  const filename = `tracking-${from}-to-${to}.csv`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
