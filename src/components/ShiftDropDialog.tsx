import { useEffect, useId, useState } from 'react'
import { earlyLeaveOptions } from '../lib/earlyLeave'
import { formatMinutes } from '../lib/shiftModels'
import type { ShiftDrop, ShiftType, Worker } from '../types'

function dropNeedsTime(kind: ShiftDrop['kind']): boolean {
  return kind !== 'noshow'
}

function dropTitle(kind: ShiftDrop['kind']): string {
  if (kind === 'leave') return 'ירידה ממשמרת'
  if (kind === 'noshow') return 'לא הגיע מתחילת המשמרת'
  return 'ביטול'
}

export function ShiftDropDialog({
  worker,
  shiftType,
  initial,
  onClose,
  onConfirm,
}: {
  worker: Worker
  shiftType: ShiftType
  initial?: ShiftDrop | null
  onClose: () => void
  onConfirm: (drop: ShiftDrop) => void
}) {
  const titleId = useId()
  const options = earlyLeaveOptions(shiftType)
  const [kind, setKind] = useState<ShiftDrop['kind']>(initial?.kind ?? 'leave')
  const [minutes, setMinutes] = useState(
    String(initial?.minutes ?? options[0]?.minutes ?? ''),
  )
  const [reason, setReason] = useState(initial?.reason ?? '')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const ready = reason.trim().length > 0 && (!dropNeedsTime(kind) || minutes !== '')

  return (
    <div className="fixed inset-0 z-[400] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
      >
        <h3 id={titleId} className="font-display text-lg font-bold text-ink">
          הורדה ממשמרת
        </h3>
        <p className="mt-1 text-sm font-semibold text-ink">{worker.fullName}</p>
        <div className="mt-3 grid gap-2">
          {(
            [
              ['leave', 'ירידה ממשמרת', 'ישב עד שעה מסוימת. העומס מחושב רק עד אז.'],
              ['cancel', 'ביטול', 'המשמרת בוטלה. נרשמות שעה וסיבה.'],
              ['noshow', 'לא הגיע', 'לא הגיע מתחילת המשמרת. אין שעות ואין עומס.'],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKind(id)}
              className={`rounded-xl border px-3 py-2 text-right ${
                kind === id ? 'border-brand bg-brand/10' : 'border-line bg-surface'
              }`}
            >
              <span className="block text-sm font-semibold text-ink">{label}</span>
              <span className="mt-0.5 block text-[12px] text-ink-soft">{hint}</span>
            </button>
          ))}
        </div>
        {dropNeedsTime(kind) ? (
          <label className="mt-3 block text-sm font-medium text-ink">
            שעה
            <select
              className="ui-field mt-1"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-[13px] text-ink-soft">
            אין שעת יציאה. {worker.fullName} לא נספר במשמרת.
          </p>
        )}
        <label className="mt-3 block text-sm font-medium text-ink">
          סיבה
          <textarea
            className="ui-field mt-1 min-h-20"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            placeholder={
              kind === 'noshow'
                ? 'למשל הודיע בבוקר שלא מגיע'
                : 'למשל הרגיש לא טוב, או ביטל לפני המשמרת'
            }
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            סגור
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={!ready}
            onClick={() =>
              onConfirm({
                workerId: worker.id,
                kind,
                minutes: dropNeedsTime(kind) ? Number(minutes) : 0,
                reason: reason.trim(),
              })
            }
          >
            אישור
          </button>
        </div>
      </div>
    </div>
  )
}

export function ShiftDropSummary({
  drops,
  workers,
  onUndo,
}: {
  drops: ShiftDrop[]
  workers: Worker[]
  onUndo: (workerId: string) => void
}) {
  if (drops.length === 0) return null
  return (
    <section className="rounded-2xl border border-line/70 bg-card px-4 py-3">
      <h3 className="text-sm font-semibold text-ink">סיכום הורדות מהמשמרת</h3>
      <ul className="mt-2 space-y-2">
        {drops.map((drop) => {
          const name = workers.find((worker) => worker.id === drop.workerId)?.fullName ?? drop.workerId
          return (
            <li
              key={drop.workerId}
              className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-surface px-3 py-2"
            >
              <div>
                <p className="text-sm font-semibold text-ink">
                  {name} · {dropTitle(drop.kind)}
                  {drop.kind === 'noshow' ? '' : ` · ${formatMinutes(drop.minutes)}`}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-soft">{drop.reason}</p>
              </div>
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={() => onUndo(drop.workerId)}
              >
                בטל הורדה
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
