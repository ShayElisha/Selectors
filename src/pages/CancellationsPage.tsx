import { useMemo, useState } from 'react'
import { CalendarX2, Search, AlertTriangle, Download, RotateCcw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { EmptyState, Ltr, PersonChip, SectionCard } from '../components/ui'
import { SHIFT_TYPE_LABELS } from '../constants'
import { formatShiftDate } from '../lib/hebrew'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import { downloadCancellationsCsv } from '../lib/cancellationsExport'
import type { ShiftDrop, ShiftSchedule, ShiftType } from '../types'

const SHIFT_TYPES: ShiftType[] = ['morning', 'afternoonA', 'afternoonB', 'afternoon', 'night']

function lanesForDrop(shift: ShiftSchedule, drop: ShiftDrop): string[] {
  if (drop.laneIds?.length) return drop.laneIds
  const ids = new Set<string>()
  for (const segment of shift.seatSegments ?? []) {
    if (segment.workerId === drop.workerId) ids.add(segment.laneId)
  }
  for (const row of shift.assignments ?? []) {
    if (row.workerIds.includes(drop.workerId)) ids.add(row.laneId)
  }
  for (const round of shift.rounds ?? []) {
    for (const row of round.assignments) {
      if (row.workerIds.includes(drop.workerId)) ids.add(row.laneId)
    }
  }
  return [...ids]
}

function getShiftGaps(shift: ShiftSchedule, lanes: ReturnType<typeof useApp>['data']['lanes']) {
  const source = shift.rounds?.length
    ? shift.rounds[shift.rounds.length - 1]!.assignments
    : shift.assignments
  const active = new Set(shift.activeLaneIds)
  return source.reduce((total, assignment) => {
    if (!active.has(assignment.laneId)) return total
    const lane = lanes.find((item) => item.id === assignment.laneId)
    if (!lane) return total
    const empty = (assignment.workerIds || []).filter((id) => !id).length
    const standard = effectiveStaffingStandard(lane, shift.staffingOverrides)
    return total + Math.max(empty, standard - (assignment.workerIds || []).filter(Boolean).length)
  }, 0)
}

export function CancellationsPage() {
  const { data } = useApp()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | ShiftDrop['kind']>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [shiftType, setShiftType] = useState<'all' | ShiftType>('all')
  const [laneId, setLaneId] = useState('all')
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all')
  const workers = useMemo(() => new Map(data.workers.map((worker) => [worker.id, worker.fullName])), [data.workers])
  const allRows = useMemo(() => {
    return data.history
      .flatMap((shift) => (shift.shiftDrops || [])
        .map((drop) => ({ shift, drop, workerName: workers.get(drop.workerId) || 'עובד לא מזוהה' })))
      .sort((a, b) => b.shift.date.localeCompare(a.shift.date) || b.shift.updatedAt.localeCompare(a.shift.updatedAt))
  }, [data.history, workers])
  const periodRows = useMemo(() => {
    const start = fromDate && toDate && fromDate > toDate ? toDate : fromDate
    const end = fromDate && toDate && fromDate > toDate ? fromDate : toDate
    return allRows
      .filter(({ shift }) => (!start || shift.date >= start) && (!end || shift.date <= end))
      .filter(({ shift }) => shiftType === 'all' || shift.shiftType === shiftType)
      .filter(({ shift, drop }) => laneId === 'all' || lanesForDrop(shift, drop).includes(laneId))
      .filter(({ shift }) => status === 'all' || (status === 'closed') === Boolean(shift.signOff?.signedAt))
      .filter(({ drop }) => kind === 'all' || drop.kind === kind)
  }, [allRows, fromDate, toDate, shiftType, laneId, status, kind])
  const rows = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('he')
    return periodRows.filter(({ shift, drop, workerName }) => !text || [workerName, drop.reason, shift.date, SHIFT_TYPE_LABELS[shift.shiftType]].some((value) => value.toLocaleLowerCase('he').includes(text)))
  }, [periodRows, query])
  const canceled = periodRows.filter(({ drop }) => drop.kind === 'cancel').length
  const noShows = periodRows.filter(({ drop }) => drop.kind === 'noshow').length
  const earlyLeaves = periodRows.filter(({ drop }) => drop.kind === 'leave').length
  const unclosed = new Set(periodRows.filter(({ shift }) => !shift.signOff?.signedAt).map(({ shift }) => shift.id)).size
  const laneNames = useMemo(() => new Map(data.lanes.map((lane) => [lane.id, lane.name])), [data.lanes])
  const resetFilters = () => {
    setQuery('')
    setKind('all')
    setFromDate('')
    setToDate('')
    setShiftType('all')
    setLaneId('all')
    setStatus('all')
  }
  const hasFilters = Boolean(query || kind !== 'all' || fromDate || toDate || shiftType !== 'all' || laneId !== 'all' || status !== 'all')
  const reversedDateRange = Boolean(fromDate && toDate && fromDate > toDate)
  const rangeStart = reversedDateRange ? toDate : fromDate
  const rangeEnd = reversedDateRange ? fromDate : toDate
  const today = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const openShifts = data.history.filter((shift) => shift.date >= todayISO && !shift.signOff?.signedAt)
  const gaps = useMemo(() => openShifts.reduce((sum, shift) => sum + getShiftGaps(shift, data.lanes), 0), [openShifts, data.lanes])

  return (
    <div className="space-y-4">
      <SectionCard title="לוח חוסרים וביטולים" subtitle="ביטולים, אי הגעה ועמדות שעדיין חסר להן כיסוי, לפי השיבוצים השמורים.">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-soft">סיכום לפי טווח התאריכים והמסננים שנבחרו</p>
          <button type="button" className="ui-btn ui-btn-secondary min-h-9" onClick={() => downloadCancellationsCsv(rows, data.lanes, { fromDate: rangeStart, toDate: rangeEnd })} disabled={rows.length === 0}>
            <Download className="size-4" aria-hidden />ייצוא {rows.length} אירועים
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-ink-soft">ביטולים בתקופה</p><p className="mt-1 text-xl font-bold tabular-nums text-ink">{canceled}</p></div>
          <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-ink-soft">אי הגעה בתקופה</p><p className="mt-1 text-xl font-bold tabular-nums text-ink">{noShows}</p></div>
          <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-ink-soft">יציאות מוקדמות בתקופה</p><p className="mt-1 text-xl font-bold tabular-nums text-ink">{earlyLeaves}</p></div>
          <div className="rounded-xl border border-warn/30 bg-warn-soft p-3"><p className="text-xs text-warn">משמרות שטרם נסגרו</p><p className="mt-1 text-xl font-bold tabular-nums text-warn">{unclosed}</p></div>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-surface/70 p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="relative sm:col-span-2 lg:col-span-1">
              <span className="sr-only">חיפוש עובד, סיבה או משמרת</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
              <input className="ui-input w-full ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש עובד או סיבה" aria-label="חיפוש ביטולים" />
            </label>
            <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs font-semibold text-ink-soft">מתאריך<input className="ui-input min-w-0" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs font-semibold text-ink-soft">עד תאריך<input className="ui-input min-w-0" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
            <select className="ui-input" value={shiftType} onChange={(event) => setShiftType(event.target.value as 'all' | ShiftType)} aria-label="סינון לפי משמרת">
              <option value="all">כל המשמרות</option>{SHIFT_TYPES.map((type) => <option key={type} value={type}>{SHIFT_TYPE_LABELS[type]}</option>)}
            </select>
            <select className="ui-input" value={laneId} onChange={(event) => setLaneId(event.target.value)} aria-label="סינון לפי עמדה">
              <option value="all">כל העמדות</option>{data.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}
            </select>
            <select className="ui-input" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="סינון לפי סוג אירוע">
              <option value="all">כל סוגי האירועים</option><option value="cancel">ביטול</option><option value="noshow">אי הגעה</option><option value="leave">יציאה מוקדמת</option>
            </select>
            <select className="ui-input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="סינון לפי סטטוס המשמרת">
              <option value="all">כל הסטטוסים</option><option value="open">משמרת פתוחה</option><option value="closed">משמרת נסגרה</option>
            </select>
            {hasFilters ? <button type="button" className="ui-btn ui-btn-ghost justify-self-start text-xs" onClick={resetFilters}><RotateCcw className="size-3.5" aria-hidden />איפוס מסננים</button> : null}
          </div>
          {reversedDateRange ? <p className="mt-2 text-xs text-ink-soft">טווח התאריכים סודר אוטומטית לפי תאריך מוקדם ומאוחר.</p> : null}
        </div>
        <div className="mt-4 divide-y divide-line">
          {rows.length === 0 ? <EmptyState title="לא נמצאו אירועים" text="אירועים נרשמים בלוח המשמרת בזמן סימון ביטול, אי הגעה או יציאה מוקדמת." /> : rows.map(({ shift, drop, workerName }, index) => (
            <article key={`${shift.id}:${drop.workerId}:${drop.kind}:${index}`} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2"><PersonChip name={workerName} /><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${drop.kind === 'cancel' ? 'bg-hard-soft text-hard' : drop.kind === 'noshow' ? 'bg-warn-soft text-warn' : 'bg-surface text-ink-soft'}`}>{drop.kind === 'cancel' ? 'ביטל/ה' : drop.kind === 'noshow' ? 'לא הגיע/ה' : 'יצא/ה מוקדם'}</span></div>
                <p className="text-sm text-ink">{SHIFT_TYPE_LABELS[shift.shiftType]} · <Ltr>{formatShiftDate(shift.date)}</Ltr></p>
                <p className="text-xs text-ink-soft">עמדות: {lanesForDrop(shift, drop).map((id) => laneNames.get(id) ?? id).join(' · ') || 'לא צוין'} · משמרת {shift.signOff?.signedAt ? 'נסגרה' : 'פתוחה'}</p>
                <p className="text-sm text-ink-soft">{drop.reason}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft"><CalendarX2 className="size-3.5" aria-hidden />{shift.audience === 'selector' ? 'בודק/ת שטח' : 'בודק/ת'}</span>
            </article>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="משמרות עם חוסרים" subtitle="הפער מחושב מהתקן מול השיבוץ האחרון שנשמר לכל משמרת.">
        <div className="space-y-2">
          {openShifts.filter((shift) => getShiftGaps(shift, data.lanes) > 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30).map((shift) => (
            <div key={shift.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
              <span className="text-sm font-semibold text-ink">{SHIFT_TYPE_LABELS[shift.shiftType]} · <Ltr>{formatShiftDate(shift.date)}</Ltr></span>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warn"><AlertTriangle className="size-4" aria-hidden />{getShiftGaps(shift, data.lanes)} מקומות חסרים</span>
            </div>
          ))}
          {gaps === 0 ? <EmptyState title="אין חוסרים בשיבוצים השמורים" text="כל המשמרות מכוסות לפי התקן שהוגדר." /> : null}
        </div>
      </SectionCard>
    </div>
  )
}
