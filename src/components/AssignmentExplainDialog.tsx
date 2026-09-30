import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Info, X } from 'lucide-react'
import { SHIFT_TYPE_LABELS } from '../constants'
import { notify } from '../lib/notify'
import type { ShiftType } from '../types'

export type ExplainGroup = {
  laneId: string
  laneName: string
  placements: { workerId: string; workerName: string; reasons: string[] }[]
}

export function groupExplanations(
  explanations: { laneId: string; workerId: string; reasons: string[] }[],
  lanes: { id: string; name: string }[],
  workers: { id: string; fullName: string }[],
): ExplainGroup[] {
  const laneName = new Map(lanes.map((lane) => [lane.id, lane.name]))
  const workerName = new Map(workers.map((worker) => [worker.id, worker.fullName]))
  const order: string[] = []
  const byLane = new Map<string, ExplainGroup>()
  for (const item of explanations) {
    if (!item.reasons.length) continue
    let group = byLane.get(item.laneId)
    if (!group) {
      group = {
        laneId: item.laneId,
        laneName: laneName.get(item.laneId) ?? 'נתיב',
        placements: [],
      }
      byLane.set(item.laneId, group)
      order.push(item.laneId)
    }
    group.placements.push({
      workerId: item.workerId,
      workerName: workerName.get(item.workerId) ?? 'לא ידוע',
      reasons: item.reasons,
    })
  }
  return order.map((id) => byLane.get(id)!)
}

function visibleReasons(reasons: string[], hideTechnical: boolean): string[] {
  if (!hideTechnical) return reasons
  return reasons.filter((reason) => !reason.includes('סדר מילוי') && !reason.includes('#'))
}

export function AssignmentExplainDialog({
  open,
  onClose,
  date,
  shiftType,
  groups,
  returnFocusRef,
}: {
  open: boolean
  onClose: () => void
  date: string
  shiftType: ShiftType
  groups: ExplainGroup[]
  returnFocusRef?: RefObject<HTMLButtonElement | null>
}) {
  const modalRef = useRef<HTMLDivElement | null>(null)
  const [hideTechnical, setHideTechnical] = useState(true)
  const [copyFlash, setCopyFlash] = useState(false)

  const text = useMemo(() => {
    const header = `הסבר שיבוץ · ${new Date(`${date}T12:00:00`).toLocaleDateString('he-IL')} · ${SHIFT_TYPE_LABELS[shiftType]}`
    const blocks = groups.map((group) => {
      const people = group.placements
        .map((placement) => {
          const reasons = visibleReasons(placement.reasons, hideTechnical)
          const bullets = reasons.map((reason) => `  • ${reason}`).join('\n')
          return bullets ? `${placement.workerName}\n${bullets}` : placement.workerName
        })
        .join('\n')
      return `${group.laneName}\n${people}`
    })
    return [header, ...blocks].join('\n\n')
  }, [date, groups, hideTechnical, shiftType])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const copy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('העתיקו את ההסבר:', text)
    }
    setCopyFlash(true)
    notify.success('ההסבר הועתק')
    window.setTimeout(() => setCopyFlash(false), 1500)
  }

  const close = () => {
    onClose()
    returnFocusRef?.current?.focus()
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-ink/50 p-3 no-print sm:items-center sm:p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="explain-modal-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col animate-fade-up rounded-2xl border border-line bg-card shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-accent-soft text-accent sm:size-9">
              <Info className="size-4 sm:size-5" aria-hidden />
            </span>
            <div>
              <h3
                id="explain-modal-title"
                className="font-display text-base font-bold text-ink sm:text-lg"
              >
                הסבר השיבוץ
              </h3>
              <p className="text-[11px] text-ink-soft sm:text-xs">פירוט מלא</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="סגור"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
          {groups.length === 0 ? (
            <p className="text-sm text-ink-soft">אין הסבר שמור למשמרת הזו.</p>
          ) : (
            groups.map((group) => (
              <div
                key={group.laneId}
                className="mb-3 rounded-xl border border-line bg-surface/70 px-3 py-2.5 last:mb-0"
              >
                <h4 className="mb-1 text-sm font-bold text-brand">{group.laneName}</h4>
                <div className="mt-1.5 space-y-2.5">
                  {group.placements.map((placement) => (
                    <div key={`${group.laneId}-${placement.workerId}`}>
                      <p className="text-xs font-semibold text-ink sm:text-sm">
                        {placement.workerName}
                      </p>
                      <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-[11px] leading-relaxed text-ink-soft sm:text-xs">
                        {visibleReasons(placement.reasons, hideTechnical).map((reason, index) => (
                          <li key={index}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => setHideTechnical((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-sm"
          >
            {hideTechnical ? 'הצג פרטים טכניים' : 'הסתר פרטים טכניים'}
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:text-sm"
          >
            {copyFlash ? (
              <Check className="size-3.5 text-ok" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            {copyFlash ? 'הועתק' : 'העתק'}
          </button>
          <button
            type="button"
            onClick={close}
            className="ms-auto inline-flex flex-1 items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-xs font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-none sm:px-5 sm:text-sm"
          >
            סגור
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
