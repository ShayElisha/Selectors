import { useEffect, useMemo, useState } from 'react'
import { fetchAuditLogs, type AuditLogEntry } from '../api'
import { formatLoadOneDecimal } from '../lib/analytics'
import {
  busiestHardWeekday,
  completedShiftCount,
  hardLoadByWeekday,
  laneUtilization,
  monthlyLoadTrend,
  overrideReport,
} from '../lib/orgHealth'
import type { Lane, ShiftSchedule } from '../types'
import { Ltr, SectionCard } from './ui'

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface ring-1 ring-line/70">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${width}%` }} />
    </div>
  )
}

export function OrgHealthPanel({
  history,
  lanes,
  fromDate,
  toDate,
}: {
  history: ShiftSchedule[]
  lanes: Lane[]
  fromDate?: string
  toDate?: string
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  useEffect(() => {
    let cancelled = false
    void fetchAuditLogs(500)
      .then((rows) => {
        if (!cancelled) setLogs(rows)
      })
      .catch(() => {
        if (!cancelled) setLogs([])
      })
    return () => {
      cancelled = true
    }
  }, [history.length])

  const shifts = completedShiftCount(history, fromDate, toDate)
  const weekdays = useMemo(
    () => hardLoadByWeekday(history, lanes, fromDate, toDate),
    [history, lanes, fromDate, toDate],
  )
  const busiest = busiestHardWeekday(weekdays)
  const lanesUsed = useMemo(
    () => laneUtilization(history, lanes, fromDate, toDate).slice(0, 8),
    [history, lanes, fromDate, toDate],
  )
  const months = useMemo(() => monthlyLoadTrend(history, lanes).slice(-8), [history, lanes])
  const overrides = overrideReport(logs, fromDate, toDate)
  const maxHard = Math.max(...weekdays.map((row) => row.hard), 1)
  const maxLane = Math.max(...lanesUsed.map((row) => row.rate), 0.01)
  const maxMonth = Math.max(...months.map((row) => Math.abs(row.load)), 1)

  return (
    <SectionCard
      title="בריאות הארגון"
      subtitle="ניצולת הנתיבים, העומס לפי יום, ומגמת החודשים. לפי הטווח שבחרתם."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-surface px-3 py-2.5 ring-1 ring-line/70">
          <p className="text-[12px] text-ink-soft">משמרות שבוצעו</p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink">
            <Ltr>{String(shifts)}</Ltr>
          </p>
        </div>
        <div className="rounded-xl bg-surface px-3 py-2.5 ring-1 ring-line/70">
          <p className="text-[12px] text-ink-soft">היום העמוס בנתיבים קשים</p>
          <p className="font-display text-2xl font-bold text-ink">
            {busiest ? busiest.label : 'אין'}
          </p>
          {busiest ? (
            <p className="text-[12px] text-ink-soft">
              <Ltr>{formatLoadOneDecimal(busiest.hard)}</Ltr> שיבוצי נתיב קשה
            </p>
          ) : null}
        </div>
        <div className="rounded-xl bg-surface px-3 py-2.5 ring-1 ring-line/70">
          <p className="text-[12px] text-ink-soft">דריסה של הצעת המערכת</p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink">
            <Ltr>{String(overrides.manual)}</Ltr>
          </p>
          <p className="text-[12px] text-ink-soft">
            מתוך <Ltr>{String(overrides.auto + overrides.manual)}</Ltr> פעולות שיבוץ ביומן
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">עומס קשה לפי יום בשבוע</h3>
          <ul className="space-y-1.5">
            {weekdays.map((row) => (
              <li key={row.weekday} className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-2 text-[12px]">
                <span className={row.weekday === busiest?.weekday ? 'font-bold text-ink' : 'text-ink-soft'}>
                  {row.label}
                </span>
                <Bar value={row.hard} max={maxHard} className="bg-hard/70" />
                <Ltr className="text-end tabular-nums text-ink">{formatLoadOneDecimal(row.hard)}</Ltr>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">ניצולת נתיבים</h3>
          {lanesUsed.length === 0 ? (
            <p className="text-[13px] text-ink-soft">אין שיבוצים בטווח.</p>
          ) : (
            <ul className="space-y-1.5">
              {lanesUsed.map((row) => (
                <li key={row.laneId} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-[12px]">
                  <span className="truncate text-ink">{row.name}</span>
                  <Bar value={row.rate} max={maxLane} className="bg-brand/70" />
                  <Ltr className="text-end tabular-nums text-ink">
                    {Math.round(row.rate * 100)}%
                  </Ltr>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-bold text-ink">מגמת עומס חודשית</h3>
        {months.length === 0 ? (
          <p className="text-[13px] text-ink-soft">אין משמרות לבניית מגמה.</p>
        ) : (
          <ul className="flex items-end gap-2 overflow-x-auto pb-1">
            {months.map((row) => {
              const up = row.load >= 0
              const height = Math.max(8, (Math.abs(row.load) / maxMonth) * 72)
              return (
                <li key={row.month} className="flex w-12 shrink-0 flex-col items-center gap-1">
                  <Ltr className="text-[10px] tabular-nums text-ink-soft">
                    {formatLoadOneDecimal(row.load)}
                  </Ltr>
                  <div
                    className={`w-6 rounded-t-md ${up ? 'bg-hard/70' : 'bg-easy/70'}`}
                    style={{ height }}
                    title={row.month}
                  />
                  <Ltr className="text-[10px] text-ink-soft">{row.month.slice(5)}</Ltr>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}
