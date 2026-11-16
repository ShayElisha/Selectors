import { useEffect, useId, useState } from 'react'
import { Lock } from 'lucide-react'
import { Ltr } from './ui'
import { formatSignOffStamp, namesMatchForSignOff } from '../lib/shiftSignOff'
import type { ShiftSignOff } from '../types'

export function ShiftClosedBanner({ signOff }: { signOff: ShiftSignOff }) {
  const stamp = formatSignOffStamp(signOff.signedAt)
  return (
    <div
      role="status"
      className="rounded-xl border border-ok/30 bg-ok-soft px-3 py-2.5 text-[13px] text-ok sm:px-4"
    >
      <p className="flex items-center gap-1.5 font-bold">
        <Lock className="size-3.5" aria-hidden />
        המשמרת נסגרה
      </p>
      <p className="mt-0.5 leading-relaxed">
        הלוח נעול. {signOff.signerName} חתם
        {stamp ? (
          <>
            {' '}
            ב־<Ltr>{stamp}</Ltr>
          </>
        ) : null}
        .
      </p>
    </div>
  )
}

export function ShiftSignOffDialog({
  accountName,
  busy,
  onClose,
  onConfirm,
  summary,
}: {
  accountName: string
  busy: boolean
  onClose: () => void
  onConfirm: (signature: string) => void
  summary?: {
    managerName: string | null
    managerMissing: boolean
    filledSlots: number
    requiredSlots: number
    missingSlots: number
    unassignedCount: number
    understaffedLanes: { name: string; filled: number; standard: number }[]
  } | null
}) {
  const titleId = useId()
  const [signature, setSignature] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const ready = namesMatchForSignOff(signature, accountName)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md animate-fade-up overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
      >
        <div className="mb-3 flex items-start gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Lock className="size-4" aria-hidden />
          </span>
          <div>
            <h3 id={titleId} className="font-display text-base font-bold text-ink sm:text-lg">
              סגירת משמרת
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              האישור נועל את הלוח. אחרי הסגירה לא ניתן לשנות או למחוק את השיבוץ.
            </p>
          </div>
        </div>
        {summary ? (
          <div
            className="mb-4 rounded-xl border border-line bg-surface/70 px-3 py-2.5 text-[13px]"
            aria-label="סיכום לפני סגירה"
          >
            <p className="font-semibold text-ink">סיכום לפני סגירה</p>
            <ul className="mt-1.5 space-y-1 text-ink-soft">
              <li>
                מנהל משמרת:{' '}
                <span className="font-semibold text-ink">
                  {summary.managerMissing
                    ? 'לא נבחר'
                    : summary.managerName || '—'}
                </span>
              </li>
              <li>
                מאוישים:{' '}
                <Ltr className="font-semibold text-ink">
                  {summary.filledSlots}/{summary.requiredSlots}
                </Ltr>
                {summary.missingSlots > 0 ? (
                  <span className="font-semibold text-warn">
                    {' '}
                    · חסרים {summary.missingSlots}
                  </span>
                ) : (
                  <span className="font-semibold text-ok"> · מלא</span>
                )}
              </li>
              {summary.unassignedCount > 0 ? (
                <li className="font-semibold text-warn">
                  {summary.unassignedCount} לא שובצו לעמדה
                </li>
              ) : null}
            </ul>
            {summary.understaffedLanes.length > 0 ? (
              <ul className="mt-2 space-y-0.5 border-t border-line/70 pt-2 text-[12px] text-warn">
                {summary.understaffedLanes.map((lane) => (
                  <li key={lane.name}>
                    {lane.name}:{' '}
                    <Ltr>
                      {lane.filled}/{lane.standard}
                    </Ltr>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <label className="block text-[13px] font-medium text-ink">
          חתימה — הקלידו את השם המלא שלכם
          <input
            className="ui-field mt-1.5"
            value={signature}
            autoComplete="name"
            autoFocus
            disabled={busy}
            onChange={(event) => {
              setSignature(event.target.value)
              setMismatch(false)
            }}
          />
        </label>
        <p className="mt-1.5 text-[12px] text-ink-soft">
          השם במערכת: {accountName || '—'}
        </p>
        {mismatch ? (
          <p className="mt-2 text-[13px] font-medium text-hard" role="alert">
            החתימה צריכה להיות בדיוק השם המלא של המנהל שמחובר.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="ui-btn ui-btn-secondary min-h-10"
          >
            ביטול
          </button>
          <button
            type="button"
            disabled={busy || !signature.trim()}
            onClick={() => {
              if (!ready) {
                setMismatch(true)
                return
              }
              onConfirm(signature.trim())
            }}
            className="ui-btn ui-btn-primary min-h-10 gap-2"
          >
            <Lock className="size-4" aria-hidden />
            סגירה ונעילה
          </button>
        </div>
      </div>
    </div>
  )
}
