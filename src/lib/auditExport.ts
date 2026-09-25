import type { AuditLogEntry } from '../api'

/** Escape a CSV cell (Excel-friendly, UTF-8) */
function csvCell(value: string | number): string {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: 'התחברות',
  shift_save: 'שמירת שיבוץ',
  shift_update: 'עדכון שיבוץ',
  shift_delete: 'מחיקת שיבוץ',
  auto_assign: 'שיבוץ אוטומטי',
  manual_assign: 'שיבוץ ידני',
  manual_swap: 'החלפת עמדות',
  lane_note: 'הערת עמדה',
  export_board: 'ייצוא / שיתוף',
  worker_cert_change: 'שינוי הסמכת בודק',
  lane_req_change: 'שינוי דרישות נתיב',
  data_update: 'עדכון נתונים',
  data_reset: 'איפוס נתונים',
  manager_invite: 'שליחת סיסמה זמנית',
  password_reset: 'איפוס סיסמה',
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export type AuditExportFilterSummary = {
  q?: string
  action?: string
  actorName?: string
  actorPhone?: string
  details?: string
  dateFrom?: string
  dateTo?: string
  totalLogs: number
  filteredCount: number
}

/**
 * Build audit CSV that Excel opens with Hebrew correctly (UTF-8 BOM).
 * Exports the already-filtered rows (all of them, not one page).
 */
export function buildAuditCsv(
  rows: AuditLogEntry[],
  filters?: AuditExportFilterSummary,
): string {
  const header = ['זמן', 'משתמש', 'טלפון', 'פעולה', 'קוד פעולה', 'פרטים', 'מזהה']

  const body = rows.map((row) => [
    formatWhen(row.at),
    row.actor?.fullName || '',
    row.actor?.phone || '',
    auditActionLabel(row.action),
    row.action,
    row.details || '',
    row.id,
  ])

  const meta: string[] = ['יומן פעולות — שיבוצון']
  if (filters) {
    meta.push(
      `רשומות בייצוא: ${filters.filteredCount} מתוך ${filters.totalLogs}`,
    )
    const bits: string[] = []
    if (filters.q?.trim()) bits.push(`חיפוש: ${filters.q.trim()}`)
    if (filters.action && filters.action !== 'all') {
      bits.push(`פעולה: ${auditActionLabel(filters.action)}`)
    }
    if (filters.actorName?.trim()) bits.push(`משתמש: ${filters.actorName.trim()}`)
    if (filters.actorPhone?.trim()) bits.push(`טלפון: ${filters.actorPhone.trim()}`)
    if (filters.details?.trim()) bits.push(`פרטים: ${filters.details.trim()}`)
    if (filters.dateFrom) bits.push(`מתאריך: ${filters.dateFrom}`)
    if (filters.dateTo) bits.push(`עד תאריך: ${filters.dateTo}`)
    if (bits.length > 0) meta.push(`סינון: ${bits.join(' · ')}`)
    else meta.push('סינון: ללא')
  }
  meta.push(`הופק: ${new Date().toLocaleString('he-IL')}`)

  const lines = [
    meta.map(csvCell).join(','),
    '',
    header.map(csvCell).join(','),
    ...body.map((r) => r.map(csvCell).join(',')),
  ]

  return `\uFEFF${lines.join('\r\n')}`
}

export function downloadAuditExcel(
  rows: AuditLogEntry[],
  filters?: AuditExportFilterSummary,
): void {
  const csv = buildAuditCsv(rows, filters)
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `audit-${stamp}-${rows.length}.csv`
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
