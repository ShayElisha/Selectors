import { useCallback, useEffect, useState } from 'react'
import { CalendarX2, History, Loader2, RefreshCw } from 'lucide-react'
import {
  fetchWorkerHistoryRemote,
  type WorkerHistoryResponse,
} from '../api'
import { Ltr, SectionCard } from '../components/ui'
import { SHIFT_TYPE_LABELS } from '../constants'
import { formatShiftDate } from '../lib/hebrew'
import { formatMinutes } from '../lib/shiftModels'
import { notify } from '../lib/notify'
import type { ShiftType } from '../types'

function shiftLabel(type: string) {
  return SHIFT_TYPE_LABELS[type as ShiftType] || type
}

function dropKindLabel(kind: string) {
  if (kind === 'leave') return 'יציאה מוקדמת'
  if (kind === 'noshow') return 'אי הגעה'
  return 'ביטול הגעה'
}

export function WorkerHistoryPage() {
  const [data, setData] = useState<WorkerHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fetchWorkerHistoryRemote())
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'טעינת ההיסטוריה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ink-soft">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        טוען היסטוריה…
      </div>
    )
  }

  if (!data) {
    return (
      <SectionCard title="ההיסטוריה שלי" subtitle="לא ניתן לטעון נתונים כרגע.">
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => void load()}>
          נסו שוב
        </button>
      </SectionCard>
    )
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="המשמרות שלי"
        subtitle={`${data.days} הימים האחרונים · ${formatShiftDate(data.fromDate)}–${formatShiftDate(data.toDate)}`}
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2.5"
            onClick={() => void load()}
            disabled={loading}
            aria-label="רענון"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {data.shifts.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <History className="size-4 shrink-0" aria-hidden />
            אין משמרות שמורות בתקופה הזו.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.shifts.map((shift) => (
              <li
                key={shift.id}
                className="rounded-xl border border-line/70 bg-surface/40 p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink">
                    {formatShiftDate(shift.date)} · {shiftLabel(shift.shiftType)}
                  </p>
                  {shift.present ? (
                    <span className="text-xs font-semibold text-ok">נוכח/ת</span>
                  ) : (
                    <span className="text-xs text-ink-soft">לא סומנה נוכחות</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {shift.laneNames.length > 0
                    ? `נתיבים: ${shift.laneNames.join(' · ')}`
                    : 'לא שובצתם לנתיב'}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                  {shift.lateMinutes != null ? (
                    <span>איחור: {shift.lateMinutes} דק׳</span>
                  ) : null}
                  {shift.earlyLeaveAt != null ? (
                    <span>
                      יציאה ב־
                      <Ltr>{formatMinutes(shift.earlyLeaveAt)}</Ltr>
                    </span>
                  ) : null}
                  {shift.earlyMinutes != null ? (
                    <span>קיצור: {shift.earlyMinutes} דק׳</span>
                  ) : null}
                  {shift.drop ? (
                    <span>
                      {dropKindLabel(shift.drop.kind)}
                      {shift.drop.reason ? ` · ${shift.drop.reason}` : ''}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="ביטולים ויציאות"
        subtitle="ביטולי הגעה, אי־הגעה ויציאות מוקדמות שלכם בתקופה."
      >
        {data.cancellations.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <CalendarX2 className="size-4 shrink-0" aria-hidden />
            אין ביטולים או יציאות מוקדמות בתקופה הזו.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.cancellations.map((row) => (
              <li
                key={`${row.shiftId}-${row.kind}-${row.minutes}`}
                className="rounded-xl border border-line/70 p-3"
              >
                <p className="font-semibold text-ink">
                  {formatShiftDate(row.date)} · {shiftLabel(row.shiftType)}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {dropKindLabel(row.kind)}
                  {row.minutes != null ? (
                    <>
                      {' '}
                      ב־
                      <Ltr>{formatMinutes(row.minutes)}</Ltr>
                    </>
                  ) : null}
                </p>
                {row.reason ? (
                  <p className="mt-1 text-sm text-ink">{row.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
