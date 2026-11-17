import { useEffect, useId, useRef, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { SHIFT_LATE_OPTIONS, type ShiftLateMinutes } from '../lib/shiftLate'
import { AnchoredMenu } from './AnchoredMenu'

type LateMinutesControlProps = {
  value: number
  onChange: (minutes: number) => void
  /**
   * `chip` = compact select (attendance expand panel).
   * `board` = quiet clock / late chip + popover (assignment board).
   */
  variant?: 'chip' | 'board'
  label?: string
  hint?: string
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

function normalize(value: number): ShiftLateMinutes {
  if (value === 15 || value === 30 || value === 45 || value === 60) return value
  return 0
}

function optionLabel(minutes: ShiftLateMinutes, compact: boolean): string {
  if (minutes === 0) return 'בזמן'
  if (minutes === 60) return compact ? 'איחור 60׳' : 'שעה'
  return compact ? `איחור ${minutes}׳` : `${minutes} דק׳`
}

export function LateMinutesControl({
  value,
  onChange,
  variant = 'chip',
  label,
  disabled = false,
  ariaLabel,
  className = '',
}: LateMinutesControlProps) {
  const current = normalize(value)
  const late = current > 0
  const title = label ?? 'איחור'
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open || variant !== 'board') return
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
  }, [open, panelId, variant])

  if (variant === 'board') {
    if (disabled) {
      return late ? (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn ring-1 ring-warn/25 ${className}`}
        >
          {optionLabel(current, true)}
        </span>
      ) : null
    }

    return (
      <span className={`relative inline-flex ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={ariaLabel ?? title}
          title={late ? optionLabel(current, true) : 'סימון איחור'}
          onClick={() => setOpen((value) => !value)}
          className={
            late
              ? 'inline-flex min-h-6 items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn ring-1 ring-warn/25 transition hover:brightness-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
              : 'inline-flex size-7 items-center justify-center rounded-lg text-ink-soft/70 transition hover:bg-surface hover:text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
          }
        >
          {late ? (
            optionLabel(current, true)
          ) : (
            <Clock3 className="size-3.5" aria-hidden />
          )}
        </button>
        <AnchoredMenu open={open} anchorRef={triggerRef} width={168}>
          <div
            id={panelId}
            role="dialog"
            aria-label={ariaLabel ?? title}
            className="animate-fade-up px-2 py-2"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="mb-1.5 px-1 text-[11px] font-semibold text-ink-soft">
              {title}
            </p>
            <div role="group" className="grid gap-0.5">
              {SHIFT_LATE_OPTIONS.map((option) => {
                const active = current === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                    className={`min-h-9 rounded-lg px-2.5 text-start text-[13px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      active
                        ? 'bg-brand text-white'
                        : 'text-ink hover:bg-surface'
                    }`}
                  >
                    {optionLabel(option.value, false)}
                  </button>
                )
              })}
            </div>
          </div>
        </AnchoredMenu>
      </span>
    )
  }

  return (
    <select
      aria-label={ariaLabel ?? title}
      disabled={disabled}
      value={current}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      title={title}
      className={`ui-field min-h-7 w-auto max-w-full py-0.5 text-[11px] font-medium ${
        late ? 'text-ink' : 'text-ink-soft'
      } ${className}`}
    >
      {SHIFT_LATE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {optionLabel(option.value, true)}
        </option>
      ))}
    </select>
  )
}
