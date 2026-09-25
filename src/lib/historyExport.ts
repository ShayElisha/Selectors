import { INTENSITY_LABELS, SHIFT_TYPE_LABELS } from '../constants'
import type { Lane, ShiftSchedule, Worker } from '../types'
import { laneRowsForShift } from './historyList'

/** Escape a CSV cell (Excel-friendly, UTF-8) */
function csvCell(value: string | number): string {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export type HistoryExportOptions = {
  fromDate?: string
  toDate?: string
  workers: Worker[]
  lanes: Lane[]
}

/**
 * Flat assignment-history CSV for Excel (UTF-8 BOM).
 * One row per active lane in each shift.
 */
export function buildHistoryCsv(
  shifts: ShiftSchedule[],
  options: HistoryExportOptions,
): string {
  const lanesById = new Map(options.lanes.map((l) => [l.id, l]))
  const workersById = new Map(options.workers.map((w) => [w.id, w]))

  const header = [
    'תאריך',
    'סוג משמרת',
    'נתיב',
    'שייכות',
    'תקן',
    'מספר משובצים',
    'בודקים',
    'מנהל שער',
    'הערות',
  ]

  const sorted = [...shifts].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    const order = { morning: 0, afternoon: 1, night: 2 } as const
    return order[a.shiftType] - order[b.shiftType]
  })

  const body: (string | number)[][] = []
  for (const shift of sorted) {
    const gateId = shift.gateManagerWorkerId?.trim() || ''
    const gateName = gateId
      ? workersById.get(gateId)?.fullName ?? gateId
      : ''
    const rows = laneRowsForShift(shift, lanesById)
    const notesByLane = new Map(
      shift.assignments
        .filter((a) => a.notes?.trim())
        .map((a) => [a.laneId, a.notes!.trim()] as const),
    )

    if (rows.length === 0) {
      body.push([
        shift.date,
        SHIFT_TYPE_LABELS[shift.shiftType],
        '',
        '',
        '',
        0,
        '',
        gateName,
        '',
      ])
      continue
    }

    for (const row of rows) {
      const names = row.workerIds
        .map((id) => workersById.get(id)?.fullName ?? id)
        .join(' · ')
      body.push([
        shift.date,
        SHIFT_TYPE_LABELS[shift.shiftType],
        row.name,
        row.intensity ? INTENSITY_LABELS[row.intensity] : '',
        row.staffingStandard ?? '',
        row.workerIds.length,
        names,
        gateName,
        notesByLane.get(row.laneId) ?? '',
      ])
    }
  }

  const meta: string[] = ['היסטוריית שיבוצים — שיבוצון']
  if (options.fromDate || options.toDate) {
    meta.push(
      `טווח: ${options.fromDate || 'התחלה'} עד ${options.toDate || 'היום'}`,
    )
  } else {
    meta.push('טווח: כל ההיסטוריה')
  }
  meta.push(`משמרות: ${shifts.length}`)
  meta.push(`הופק: ${new Date().toLocaleString('he-IL')}`)

  const lines = [
    meta.map(csvCell).join(','),
    '',
    header.map(csvCell).join(','),
    ...body.map((r) => r.map(csvCell).join(',')),
  ]

  return `\uFEFF${lines.join('\r\n')}`
}

export function downloadHistoryExcel(
  shifts: ShiftSchedule[],
  options: HistoryExportOptions,
): void {
  const csv = buildHistoryCsv(shifts, options)
  const from = options.fromDate || 'all'
  const to = options.toDate || 'now'
  const filename = `history-${from}-to-${to}.csv`
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
