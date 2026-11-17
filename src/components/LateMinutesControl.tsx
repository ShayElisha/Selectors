import { SHIFT_LATE_OPTIONS, type ShiftLateMinutes } from '../lib/shiftLate'

type LateMinutesControlProps = {
  value: number
  onChange: (minutes: number) => void
  /** Quiet per-worker select. */
  variant?: 'chip'
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

function optionLabel(minutes: ShiftLateMinutes): string {
  if (minutes === 0) return 'בזמן'
  if (minutes === 60) return 'איחור 60׳'
  return `איחור ${minutes}׳`
}

export function LateMinutesControl({
  value,
  onChange,
  label,
  disabled = false,
  ariaLabel,
  className = '',
}: LateMinutesControlProps) {
  const current = normalize(value)
  const late = current > 0
  const title = label ?? 'איחור'

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
          {optionLabel(option.value)}
        </option>
      ))}
    </select>
  )
}
