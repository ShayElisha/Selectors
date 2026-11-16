import { Clock3 } from 'lucide-react'
import { SHIFT_LATE_OPTIONS, type ShiftLateMinutes } from '../lib/shiftLate'

type LateMinutesControlProps = {
  value: number
  onChange: (minutes: number) => void
  /** `chip` = quiet select under a worker; `bar` = shift-wide control. */
  variant?: 'chip' | 'bar'
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
  if (minutes === 0) return compact ? 'בזמן' : 'בזמן'
  if (minutes === 60) return compact ? 'איחור 60׳' : 'שעה'
  return compact ? `איחור ${minutes}׳` : `${minutes} דק׳`
}

export function LateMinutesControl({
  value,
  onChange,
  variant = 'chip',
  label,
  hint,
  disabled = false,
  ariaLabel,
  className = '',
}: LateMinutesControlProps) {
  const current = normalize(value)
  const late = current > 0
  const title = label ?? (variant === 'bar' ? 'איחור כללי' : 'איחור')

  if (variant === 'bar') {
    return (
      <div
        className={`inline-flex max-w-full flex-col gap-1 rounded-xl border px-2.5 py-2 ${
          late ? 'border-line/80 bg-card' : 'border-line/70 bg-card/80'
        } ${className}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex size-6 items-center justify-center rounded-lg bg-surface text-ink-soft"
            aria-hidden
          >
            <Clock3 className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-ink">{title}</p>
            {hint ? (
              <p className="text-[10px] leading-snug text-ink-soft">{hint}</p>
            ) : null}
          </div>
          <select
            aria-label={ariaLabel ?? title}
            disabled={disabled}
            value={current}
            onChange={(e) => onChange(Number(e.target.value) || 0)}
            className="ui-field min-h-8 w-auto min-w-[6.5rem] py-1 text-[12px] font-medium"
          >
            {SHIFT_LATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
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
