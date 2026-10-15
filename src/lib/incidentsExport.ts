import { SHIFT_TYPE_LABELS } from '../constants'
import type { IncidentRecord, Lane } from '../types'

const SEVERITY_LABELS = {
  low: 'נמוכה',
  medium: 'בינונית',
  high: 'גבוהה',
  critical: 'קריטית',
} as const

const STATUS_LABELS = {
  open: 'פתוח',
  in_progress: 'בטיפול',
  resolved: 'טופל',
} as const

function csvCell(value: string | number): string {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildIncidentsCsv(rows: IncidentRecord[], lanes: Lane[]): string {
  const laneNames = new Map(lanes.map((lane) => [lane.id, lane.name]))
  const header = [
    'נפתח בתאריך',
    'סוג דיווח',
    'כותרת',
    'תיאור',
    'חומרה',
    'סטטוס',
    'עמדה',
    'תאריך משמרת',
    'סוג משמרת',
    'טיפול שבוצע',
    'נפתח על ידי',
    'עודכן לאחרונה',
    'עודכן על ידי',
  ]
  const body = rows.map((row) => [
    new Date(row.createdAt).toLocaleString('he-IL'),
    row.kind === 'fault' ? 'תקלה' : 'אירוע',
    row.title,
    row.description,
    SEVERITY_LABELS[row.severity],
    STATUS_LABELS[row.status],
    row.laneId ? laneNames.get(row.laneId) ?? row.laneId : '',
    row.shiftDate ?? '',
    row.shiftType ? SHIFT_TYPE_LABELS[row.shiftType] : '',
    row.handlingNotes ?? '',
    row.createdBy,
    new Date(row.updatedAt).toLocaleString('he-IL'),
    row.updatedBy,
  ])
  return `\uFEFF${[header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n')}`
}

export function downloadIncidentsCsv(rows: IncidentRecord[], lanes: Lane[]): void {
  const blob = new Blob([buildIncidentsCsv(rows, lanes)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `incident-log-${new Date().toISOString().slice(0, 10)}.csv`
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
