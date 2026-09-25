import type { ShortReturnQuality } from './assignmentQuality'
import type { TeamAnalytics } from './analytics'
import { formatLoadOneDecimal } from './analytics'
import { INTENSITY_LABELS, SHIFT_TYPE_LABELS } from '../constants'
import { formatShiftDate } from './hebrew'

function csvCell(value: string | number): string {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function section(title: string, header: string[], rows: (string | number)[][]): string[] {
  return [
    csvCell(title),
    '',
    header.map(csvCell).join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
    '',
  ]
}

export type AnalyticsExportOptions = {
  fromDate?: string
  toDate?: string
  shortReturn?: ShortReturnQuality
}

/**
 * Multi-section CSV for Excel: summary, workers, lane repeats, hard-after-night.
 */
export function buildAnalyticsCsv(
  analytics: TeamAnalytics,
  options?: AnalyticsExportOptions,
): string {
  const rangeLabel =
    options?.fromDate || options?.toDate
      ? `${options.fromDate || 'התחלה'} עד ${options.toDate || 'היום'}`
      : 'כל ההיסטוריה'

  const meta = [
    ['סטטיסטיקות ואנליזה — שיבוצון'],
    [`טווח: ${rangeLabel}`],
    [`הופק: ${new Date().toLocaleString('he-IL')}`],
    [
      `משמרות: ${analytics.shiftsInRange}`,
      `בודקים עם נתונים: ${analytics.workersWithData}`,
      `ללא נתונים: ${analytics.workersWithoutData}`,
    ],
    [
      `עומס ממוצע: ${formatLoadOneDecimal(analytics.avgLoad)}`,
      `מקס: ${formatLoadOneDecimal(analytics.maxLoad)}`,
      `מינ: ${formatLoadOneDecimal(analytics.minLoad)}`,
      `פער: ${formatLoadOneDecimal(analytics.loadGap)}`,
    ],
    [
      `בוקר: ${analytics.shiftMix.morning}`,
      `צהריים: ${analytics.shiftMix.afternoon}`,
      `לילה: ${analytics.shiftMix.night}`,
    ],
    [`קשה אחרי לילה: ${analytics.hardAfterNightTotal}`],
  ]

  if (options?.shortReturn) {
    const sr = options.shortReturn
    meta.push([
      `חזרה קצרה (≤${sr.maxDays} ימים, בלי לילות): ${sr.shortReturnPlacements}/${sr.totalDayPlacements}`,
      sr.totalDayPlacements > 0
        ? `${Math.round(sr.rate * 100)}%`
        : '—',
    ])
  }

  const workerHeader = [
    'בודק',
    'עומס אפקטיבי',
    'סה״כ שיבוצים',
    'משמרות',
    'קשה',
    'בינוני',
    'קל יום',
    'קל לילה',
    'בוקר',
    'צהריים',
    'לילה',
    'קשה בוקר',
    'קשה צהריים',
    'קשה לילה',
    'נתיב מוביל',
    'ביקורים בנתיב מוביל',
    'קשה אחרי לילה',
  ]

  const workersSorted = [...analytics.workers].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'he'),
  )
  const workerRows = workersSorted.map((w) => [
    w.fullName,
    formatLoadOneDecimal(w.effectiveLoad),
    w.totalAssignments,
    w.shiftsCount,
    w.hardCount,
    w.mediumCount,
    w.dayEasyCount,
    w.nightEasyCount,
    w.shiftsByType.morning,
    w.shiftsByType.afternoon,
    w.shiftsByType.night,
    w.hardByShift.morning,
    w.hardByShift.afternoon,
    w.hardByShift.night,
    w.topLaneName ?? '',
    w.topLaneCount,
    w.hardAfterNightCount,
  ])

  const laneHeader = [
    'נתיב',
    'עצימות',
    'סה״כ ביקורים',
    'בודקים ייחודיים',
    'בודק מוביל',
    'ביקורים של המוביל',
    'ריכוז %',
  ]
  const lanesSorted = [...analytics.lanes].sort(
    (a, b) => b.concentration - a.concentration || b.totalAssignments - a.totalAssignments,
  )
  const laneRows = lanesSorted.map((l) => [
    l.laneName,
    INTENSITY_LABELS[l.intensity],
    l.totalAssignments,
    l.uniqueWorkers,
    l.topWorkerName,
    l.topWorkerCount,
    Math.round(l.concentration * 100),
  ])

  const hardHeader = [
    'בודק',
    'תאריך לילה',
    'תאריך קשה',
    'סוג משמרת',
    'נתיב',
  ]
  const hardRows = analytics.hardAfterNightEvents.map((e) => [
    e.fullName,
    formatShiftDate(e.nightDate),
    formatShiftDate(e.date),
    SHIFT_TYPE_LABELS[e.shiftType],
    e.laneName,
  ])

  const reliefHeader = ['דירוג', 'בודק', 'עומס', 'קשה', 'קל יום', 'סה״כ']
  const reliefRows = analytics.needRelief.map((w, i) => [
    i + 1,
    w.fullName,
    formatLoadOneDecimal(w.effectiveLoad),
    w.hardCount,
    w.dayEasyCount,
    w.totalAssignments,
  ])
  const restRows = analytics.gotRest.map((w, i) => [
    i + 1,
    w.fullName,
    formatLoadOneDecimal(w.effectiveLoad),
    w.hardCount,
    w.dayEasyCount,
    w.totalAssignments,
  ])

  const lines = [
    ...meta.map((row) => row.map(csvCell).join(',')),
    '',
    ...section('בודקים — עומס ושיבוצים', workerHeader, workerRows),
    ...section('מי צריך הקלה (דירוג)', reliefHeader, reliefRows),
    ...section('מי קיבל יותר מנוחה (דירוג)', reliefHeader, restRows),
    ...section('נתיבים — ריכוז וחזרות', laneHeader, laneRows),
    ...section('קשה אחרי לילה', hardHeader, hardRows),
  ]

  return `\uFEFF${lines.join('\r\n')}`
}

export function downloadAnalyticsExcel(
  analytics: TeamAnalytics,
  options?: AnalyticsExportOptions,
): void {
  const csv = buildAnalyticsCsv(analytics, options)
  const from = options?.fromDate || 'all'
  const to = options?.toDate || 'now'
  const filename = `analytics-${from}-to-${to}.csv`
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
