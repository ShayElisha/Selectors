import { useEffect } from 'react'
import { CalendarX2, History, RefreshCw } from 'lucide-react'
import { PageLoader } from '../components/PageLoader'
import { IntensityBadge, Ltr, SectionCard } from '../components/ui'
import { useWorkerPortal } from '../context/WorkerPortalContext'
import { INTENSITY_LABELS, SHIFT_TYPE_LABELS } from '../constants'
import { formatShiftDate } from '../lib/hebrew'
import { formatMinutes } from '../lib/shiftModels'
import type { Intensity, ShiftType } from '../types'

function shiftLabel(type: string) {
  return SHIFT_TYPE_LABELS[type as ShiftType] || type
}

function dropKindLabel(kind: string) {
  if (kind === 'leave') return 'יציאה מוקדמת'
  if (kind === 'noshow') return 'אי הגעה'
  return 'ביטול הגעה'
}

export function WorkerHistoryPage() {
  const {
    history: data,
    historyLoading: loading,
    historyRefreshing: refreshing,
    historyError,
    refreshHistory,
  } = useWorkerPortal()

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  if (loading && !data) {
    return <PageLoader label="טוען נתונים…" />
  }

  if (!data) {
    return (
      <SectionCard
        title="ההיסטוריה שלי"
        subtitle={historyError || 'לא ניתן לטעון נתונים כרגע.'}
      >
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          onClick={() => void refreshHistory()}
        >
          נסו שוב
        </button>
      </SectionCard>
    )
  }

  const intensity = data.intensityStats || { easy: 0, medium: 0, hard: 0 }

  return (
    <div className="space-y-4">
      <SectionCard
        title="סטטיסטיקות אישיות"
        subtitle={`חודש אחורה · רק משמרות שכבר התחילו (${formatShiftDate(data.fromDate)}–${formatShiftDate(data.toDate)})`}
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2.5"
            onClick={() => void refreshHistory({ silent: true })}
            disabled={loading || refreshing}
            aria-label="רענון"
          >
            <RefreshCw
              className={`size-4 ${loading || refreshing ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {(['easy', 'medium', 'hard'] as const).map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 ring-1 ring-line"
            >
              <IntensityBadge intensity={key} />
              <span className="font-semibold text-ink">{intensity[key]}</span>
              <span className="text-ink-soft">{INTENSITY_LABELS[key]}</span>
            </span>
          ))}
        </div>
        {(data.laneStats || []).length === 0 ? (
          <p className="text-sm text-ink-soft">אין עדיין נתוני נתיבים לחודש הזה.</p>
        ) : (
          <ul className="space-y-2">
            {data.laneStats.map((row) => (
              <li
                key={row.laneId || row.laneName}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 px-3 py-2"
              >
                <span className="font-semibold text-ink">{row.laneName}</span>
                <span className="text-sm text-ink-soft">
                  {row.count}× · קל {row.byIntensity.easy} · בינוני{' '}
                  {row.byIntensity.medium} · קשה {row.byIntensity.hard}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="היסטוריית נתיבים"
        subtitle="כל נתיב שבו שובצתם בחודש האחרון (משמרות שהחלו בלבד)."
      >
        {(data.laneHistory || []).length === 0 ? (
          <p className="text-sm text-ink-soft">אין שיבוצי נתיבים בתקופה.</p>
        ) : (
          <ul className="space-y-2">
            {data.laneHistory.map((row, i) => (
              <li
                key={`${row.date}-${row.laneId}-${i}`}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-line/60 px-3 py-2 text-sm"
              >
                <span className="text-ink-soft">{formatShiftDate(row.date)}</span>
                <span className="text-ink-soft">· {shiftLabel(row.shiftType)}</span>
                <span className="font-semibold text-ink">{row.laneName}</span>
                <IntensityBadge intensity={(row.intensity as Intensity) || 'medium'} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="המשמרות שלי"
        subtitle="הווה ועבר בלבד — משמרות עתידיות שעוד לא התחילו לא מופיעות."
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
        subtitle="ביטולי הגעה, אי־הגעה ויציאות מוקדמות בתקופה."
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
