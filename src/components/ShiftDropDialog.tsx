import { useEffect, useId, useState } from 'react'
import { earlyLeaveOptions } from '../lib/earlyLeave'
import { formatMinutes } from '../lib/shiftModels'
import type { ShiftDrop, ShiftType, Worker } from '../types'

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

  const ready = reason.trim().length > 0 && minutes !== ''

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
        <p className="mt-1 text-sm text-ink">
          {worker.fullName}
        </p>
        <div className="mt-3 flex gap-2">
          {(
            [
              ['leave', 'ירידה ממשמרת'],
              ['cancel', 'ביטול'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKind(id)}
              className={`ui-btn ${kind === id ? 'ui-btn-primary' : 'ui-btn-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>
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
        <label className="mt-3 block text-sm font-medium text-ink">
          סיבה
          <textarea
            className="ui-field mt-1 min-h-20"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            placeholder="למשל הרגיש לא טוב, או ביטל לפני המשמרת"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={!ready}
            onClick={() =>
              onConfirm({
                workerId: worker.id,
                kind,
                minutes: Number(minutes),
                reason: reason.trim(),
              })
            }
          >
            אישור הורדה
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
                  {name} · {drop.kind === 'leave' ? 'ירידה ממשמרת' : 'ביטול'} ·{' '}
                  {formatMinutes(drop.minutes)}
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
