import { useEffect, useId, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { AnchoredMenu } from './AnchoredMenu'
import { Ltr } from './ui'
import {
  staffingChoicesForLane,
  type StaffingStandard,
} from '../lib/shiftStaffing'
import type { Lane } from '../types'

type LaneStaffingControlProps = {
  lane: Pick<Lane, 'id' | 'name' | 'staffingStandard'>
  value: StaffingStandard
  filled: number
  /** over = seated above תקן */
  chipKind?: 'ok' | 'under' | 'over'
  onChange: (standard: StaffingStandard) => void
  editable?: boolean
  className?: string
}

/**
 * Board תקן editor: looks like the normal staffing chip until opened,
 * then a compact popover to pick 1…max.
 */
export function LaneStaffingControl({
  lane,
  value,
  filled,
  chipKind = filled >= value ? 'ok' : 'under',
  onChange,
  editable = false,
  className = '',
}: LaneStaffingControlProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const choices = staffingChoicesForLane(lane)
  const full = chipKind === 'ok'
  const over = chipKind === 'over'

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      const panel = document.getElementById(panelId)
      if (panel?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('touchstart', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('touchstart', onPointer)
    }
  }, [open, panelId])

  const badge = full ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
      <span className="size-1.5 rounded-full bg-ok" aria-hidden />
      מאויש
    </span>
  ) : (
    <span
      className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
        over
          ? 'bg-accent-soft text-accent ring-accent/20'
          : 'bg-warn-soft text-warn ring-warn/20'
      }`}
    >
      <Ltr>
        {filled}/{value}
      </Ltr>
      {over ? ' מעל תקן' : null}
    </span>
  )

  if (!editable || choices.length <= 1) {
    return <span className={className}>{badge}</span>
  }

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title="שינוי תקן"
        aria-label={`תקן ${value} בנתיב ${lane.name}. לחצו לשינוי`}
        onClick={() => setOpen((current) => !current)}
        className={`rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          open ? 'ring-2 ring-brand/25' : 'hover:brightness-[0.98]'
        }`}
      >
        {badge}
      </button>
      <AnchoredMenu open={open} anchorRef={triggerRef} width={220}>
        <div
          id={panelId}
          role="dialog"
          aria-label={`בחירת תקן ל${lane.name}`}
          className="animate-fade-up px-3 py-2.5"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-start gap-2">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Users className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-ink">תקן לנתיב</p>
              <p className="text-[11px] leading-snug text-ink-soft">
                כמה מקומות ב־{lane.name}
              </p>
            </div>
          </div>
          <div
            role="group"
            aria-label={`אפשרויות תקן ל${lane.name}`}
            className="grid grid-cols-5 gap-1"
          >
            {choices.map((n) => {
              const active = value === n
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onChange(n)
                    setOpen(false)
                  }}
                  className={`min-h-9 rounded-xl text-[13px] font-bold tabular-nums transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    active
                      ? 'bg-brand text-white shadow-sm'
                      : 'bg-surface text-ink-soft ring-1 ring-line/70 hover:bg-card hover:text-ink'
                  }`}
                >
                  {n}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] text-ink-soft">
            מקסימום בקטלוג: {lane.staffingStandard}
          </p>
        </div>
      </AnchoredMenu>
    </span>
  )
}
