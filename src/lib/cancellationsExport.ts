import { SHIFT_TYPE_LABELS } from '../constants'
import { formatShiftDate } from './hebrew'
import type { Lane, ShiftDrop, ShiftSchedule } from '../types'

export type CancellationRow = {
  shift: ShiftSchedule
  drop: ShiftDrop
  workerName: string
}

function csvCell(value: string | number): string {
  let text = String(value ?? '')
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function eventLabel(kind: ShiftDrop['kind']): string {
  if (kind === 'cancel') return 'ביטול'
  if (kind === 'noshow') return 'אי הגעה'
  return 'יציאה מוקדמת'
}

export function buildCancellationsCsv(
  rows: CancellationRow[],
  lanes: Lane[],
  range: { fromDate?: string; toDate?: string } = {},
): string {
  const laneNames = new Map(lanes.map((lane) => [lane.id, lane.name]))
  const header = [
    'תאריך', 'עובד/ת', 'סוג אירוע', 'סוג משמרת', 'עמדות', 'שעת יציאה',
    'סיבת דיווח', 'סטטוס המשמרת', 'נסגרה על ידי',
  ]
  const body = rows.map(({ shift, drop, workerName }) => [
    formatShiftDate(shift.date),
    workerName,
    eventLabel(drop.kind),
    SHIFT_TYPE_LABELS[shift.shiftType],
    (drop.laneIds ?? []).map((id) => laneNames.get(id) ?? id).join(' · ') || 'לא צוין',
    drop.minutes,
    drop.reason,
    shift.signOff?.signedAt ? 'נסגרה' : 'פתוחה',
    shift.signOff?.signerName ?? '',
  ])
  const period = range.fromDate || range.toDate
    ? `טווח: ${range.fromDate ? formatShiftDate(range.fromDate) : 'מתחילת הנתונים'} עד ${range.toDate ? formatShiftDate(range.toDate) : 'היום'}`
    : 'טווח: כל ההיסטוריה'
  const shiftIds = new Set(rows.map(({ shift }) => shift.id))
  const openShiftIds = new Set(rows.filter(({ shift }) => !shift.signOff?.signedAt).map(({ shift }) => shift.id))
  const summary = [
    ['סה״כ אירועים', rows.length],
    ['ביטולים', rows.filter(({ drop }) => drop.kind === 'cancel').length],
    ['אי הגעה', rows.filter(({ drop }) => drop.kind === 'noshow').length],
    ['יציאות מוקדמות', rows.filter(({ drop }) => drop.kind === 'leave').length],
    ['משמרות פתוחות', openShiftIds.size],
    ['משמרות סגורות', shiftIds.size - openShiftIds.size],
  ]
  return `\uFEFF${[period, ...summary, '', header, ...body].map((line) => Array.isArray(line) ? line.map(csvCell).join(',') : csvCell(line)).join('\r\n')}`
}

export function downloadCancellationsCsv(
  rows: CancellationRow[],
  lanes: Lane[],
  range: { fromDate?: string; toDate?: string } = {},
): void {
  const blob = new Blob([buildCancellationsCsv(rows, lanes, range)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const start = range.fromDate || 'all'
  const end = range.toDate || new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `cancellations-${start}-${end}.csv`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
