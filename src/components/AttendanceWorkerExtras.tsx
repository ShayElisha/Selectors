import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { LateMinutesControl } from './LateMinutesControl'

export type AttendanceWindowPreset = { id: string; label: string }
export type AttendanceLaneOption = { id: string; name: string }

type AttendanceWorkerExtrasProps = {
  workerName: string
  windowId: string
  windowPresets: AttendanceWindowPreset[]
  onWindowChange: (windowId: string) => void
  showLaneSelect: boolean
  laneId: string
  laneLockedByMentoring: boolean
  lanes: AttendanceLaneOption[]
  onLaneChange: (laneId: string | null) => void
  lateMinutes: number
  onLateChange: (minutes: number) => void
  earlyMinutes: number
  onEarlyChange: (minutes: number) => void
}

function lateSummary(minutes: number): string {
  if (!minutes) return 'בזמן'
  if (minutes === 60) return 'איחור שעה'
  return `איחור ${minutes}׳`
}

function earlySummary(minutes: number): string {
  if (!minutes) return 'עד הסוף'
  if (minutes === 60) return 'יציאה שעה'
  return `יציאה ${minutes}׳`
}

function chipClass(active: boolean, tone: 'neutral' | 'warn' | 'ok' = 'neutral') {
  if (!active) {
    return 'bg-surface text-ink-soft ring-line/70'
  }
  if (tone === 'warn') {
    return 'bg-warn-soft text-warn ring-warn/25'
  }
  if (tone === 'ok') {
    return 'bg-ok-soft text-ok ring-ok/25'
  }
  return 'bg-brand/10 text-brand ring-brand/25'
}

/**
 * Collapsed summary of per-worker shift window / lane / late / early leave.
 * Full controls stay available behind one tap — no fields removed.
 */
export function AttendanceWorkerExtras({
  workerName,
  windowId,
  windowPresets,
  onWindowChange,
  showLaneSelect,
  laneId,
  laneLockedByMentoring,
  lanes,
  onLaneChange,
  lateMinutes,
  onLateChange,
  earlyMinutes,
  onEarlyChange,
}: AttendanceWorkerExtrasProps) {
  const [open, setOpen] = useState(false)

  const windowLabel =
    windowPresets.find((preset) => preset.id === windowId)?.label ??
    (windowId || 'בחר משמרת')
  const laneLabel = laneId
    ? (lanes.find((lane) => lane.id === laneId)?.name ?? laneId)
    : 'אוטומטי'
  const late = Number(lateMinutes) || 0
  const early = Number(earlyMinutes) || 0

  const windowMissing = !windowId
  const lanePinned = Boolean(laneId)
  const lateActive = late > 0
  const earlyActive = early > 0

  return (
    <div className="border-t border-brand/10 px-2.5 pb-2 pt-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`התאמות של ${workerName}`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-h-9 items-center gap-2 rounded-xl px-2 py-1.5 text-right transition hover:bg-brand/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <span
            className={`inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${chipClass(
              windowMissing,
              'warn',
            )}`}
          >
            <span className="truncate">{windowLabel}</span>
          </span>
          {showLaneSelect ? (
            <span
              className={`inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${chipClass(
                lanePinned,
                'ok',
              )}`}
            >
              <span className="truncate">
                {lanePinned ? `📌 ${laneLabel}` : laneLabel}
                {laneLockedByMentoring ? ' · חונכות' : ''}
              </span>
            </span>
          ) : null}
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${chipClass(
              lateActive,
              'warn',
            )}`}
          >
            {lateSummary(late)}
          </span>
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${chipClass(
              earlyActive,
              'warn',
            )}`}
          >
            {earlySummary(early)}
          </span>
        </span>
        {open ? (
          <ChevronUp className="size-3.5 shrink-0 text-ink-soft" aria-hidden />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-ink-soft" aria-hidden />
        )}
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1.5 px-0.5">
          <select
            value={windowId}
            aria-label={`משמרת של ${workerName}`}
            onChange={(e) => {
              const next = e.target.value
              if (!next) return
              onWindowChange(next)
            }}
            className="ui-field w-full py-1.5 text-[13px]"
          >
            {!windowId ? <option value="">בחר משמרת</option> : null}
            {windowPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>

          {showLaneSelect ? (
            <select
              className="ui-field w-full py-1.5 text-[13px]"
              aria-label={
                laneLockedByMentoring
                  ? `נתיב חונכות עבור ${workerName}`
                  : `נתיב מועדף עבור ${workerName}`
              }
              value={laneId}
              onChange={(e) => onLaneChange(e.target.value || null)}
            >
              {laneLockedByMentoring ? null : (
                <option value="">שיבוץ אוטומטי</option>
              )}
              {lanes.map((lane) => (
                <option key={lane.id} value={lane.id}>
                  📌 {lane.name}
                </option>
              ))}
            </select>
          ) : null}

          <LateMinutesControl
            variant="chip"
            ariaLabel={`איחור של ${workerName}`}
            value={late}
            onChange={onLateChange}
            className="w-full"
          />

          <label className="block text-[11px] text-ink-soft">
            יציאה מוקדמת
            <select
              className="ui-field mt-0.5 w-full py-1.5 text-[12px]"
              aria-label={`יציאה מוקדמת של ${workerName}`}
              value={early}
              onChange={(e) => onEarlyChange(Number(e.target.value) || 0)}
            >
              <option value={0}>עד הסוף</option>
              <option value={15}>15 דק׳</option>
              <option value={30}>30 דק׳</option>
              <option value={45}>45 דק׳</option>
              <option value={60}>שעה</option>
            </select>
          </label>
        </div>
      ) : null}
    </div>
  )
}
