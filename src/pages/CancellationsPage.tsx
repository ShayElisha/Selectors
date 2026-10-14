import { useMemo, useState } from 'react'
import { CalendarX2, Search, AlertTriangle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { EmptyState, Ltr, PersonChip, SectionCard } from '../components/ui'
import { SHIFT_TYPE_LABELS } from '../constants'
import { formatShiftDate } from '../lib/hebrew'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import type { ShiftDrop, ShiftSchedule } from '../types'

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
  const workers = useMemo(() => new Map(data.workers.map((worker) => [worker.id, worker.fullName])), [data.workers])
  const allRows = useMemo(() => {
    return data.history
      .flatMap((shift) => (shift.shiftDrops || [])
        .map((drop) => ({ shift, drop, workerName: workers.get(drop.workerId) || 'עובד לא מזוהה' })))
      .sort((a, b) => b.shift.date.localeCompare(a.shift.date) || b.shift.updatedAt.localeCompare(a.shift.updatedAt))
  }, [data.history, workers])
  const rows = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('he')
    return allRows
      .filter(({ drop }) => kind === 'all' || drop.kind === kind)
      .filter(({ shift, drop, workerName }) => !text || [workerName, drop.reason, shift.date, SHIFT_TYPE_LABELS[shift.shiftType]].some((value) => value.toLocaleLowerCase('he').includes(text)))
  }, [allRows, kind, query])
  const canceled = allRows.filter(({ drop }) => drop.kind === 'cancel').length
  const noShows = allRows.filter(({ drop }) => drop.kind === 'noshow').length
  const today = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const openShifts = data.history.filter((shift) => shift.date >= todayISO && !shift.signOff?.signedAt)
  const gaps = useMemo(() => openShifts.reduce((sum, shift) => sum + getShiftGaps(shift, data.lanes), 0), [openShifts, data.lanes])

  return (
    <div className="space-y-4">
      <SectionCard title="לוח חוסרים וביטולים" subtitle="ביטולים, אי הגעה ועמדות שעדיין חסר להן כיסוי, לפי השיבוצים השמורים.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface p-4"><p className="text-sm text-ink-soft">ביטולים</p><p className="mt-1 text-2xl font-bold text-ink">{canceled}</p></div>
          <div className="rounded-xl border border-line bg-surface p-4"><p className="text-sm text-ink-soft">אי הגעה</p><p className="mt-1 text-2xl font-bold text-ink">{noShows}</p></div>
          <div className="rounded-xl border border-warn/30 bg-warn-soft p-4"><p className="text-sm text-warn">מקומות לא מאוישים במשמרות פתוחות</p><p className="mt-1 text-2xl font-bold text-warn">{gaps}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
            <input className="ui-input w-full ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש עובד, סיבה או משמרת" aria-label="חיפוש ביטולים" />
          </label>
          <select className="ui-input" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="סינון לפי סוג אירוע">
            <option value="all">כל האירועים</option><option value="cancel">ביטולים</option><option value="noshow">אי הגעה</option><option value="leave">יציאה מוקדמת</option>
          </select>
        </div>
        <div className="mt-4 divide-y divide-line">
          {rows.length === 0 ? <EmptyState title="לא נמצאו אירועים" text="אירועים נרשמים בלוח המשמרת בזמן סימון ביטול, אי הגעה או יציאה מוקדמת." /> : rows.map(({ shift, drop, workerName }, index) => (
            <article key={`${shift.id}:${drop.workerId}:${drop.kind}:${index}`} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2"><PersonChip name={workerName} /><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${drop.kind === 'cancel' ? 'bg-hard-soft text-hard' : drop.kind === 'noshow' ? 'bg-warn-soft text-warn' : 'bg-surface text-ink-soft'}`}>{drop.kind === 'cancel' ? 'ביטל/ה' : drop.kind === 'noshow' ? 'לא הגיע/ה' : 'יצא/ה מוקדם'}</span></div>
                <p className="text-sm text-ink">{SHIFT_TYPE_LABELS[shift.shiftType]} · <Ltr>{formatShiftDate(shift.date)}</Ltr></p>
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
