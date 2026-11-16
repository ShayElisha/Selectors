import { Clock3 } from 'lucide-react'
import { SHIFT_LATE_OPTIONS, type ShiftLateMinutes } from '../lib/shiftLate'

type LateMinutesControlProps = {
  value: number
  onChange: (minutes: number) => void
  /** `chip` = compact under a worker slot; `bar` = shift-wide header control. */
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
        className={`inline-flex max-w-full flex-col gap-1.5 rounded-2xl border px-3 py-2 shadow-sm ${
          late
            ? 'border-warn/30 bg-warn-soft/70'
            : 'border-line/80 bg-card/90'
        } ${className}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex size-7 items-center justify-center rounded-xl ${
              late ? 'bg-warn/15 text-warn' : 'bg-brand/10 text-brand'
            }`}
            aria-hidden
          >
            <Clock3 className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-ink">{title}</p>
            {hint ? (
              <p className="text-[10px] leading-snug text-ink-soft">{hint}</p>
            ) : null}
          </div>
        </div>
        <div
          role="group"
          aria-label={ariaLabel ?? title}
          className="flex flex-wrap gap-1"
        >
          {SHIFT_LATE_OPTIONS.map((option) => {
            const active = current === option.value
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onChange(option.value)}
                className={`min-h-9 rounded-xl px-2.5 text-[12px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 ${
                  active
                    ? option.value === 0
                      ? 'bg-ok text-white shadow-sm'
                      : 'bg-warn text-white shadow-sm'
                    : 'bg-surface text-ink-soft ring-1 ring-line/70 hover:bg-card hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`inline-flex max-w-full flex-wrap items-center gap-1.5 ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-bold ${
          late
            ? 'bg-warn-soft text-warn ring-1 ring-warn/20'
            : 'bg-surface text-ink-soft ring-1 ring-line/70'
        }`}
      >
        <Clock3 className="size-3" aria-hidden />
        {title}
      </span>
      <div
        role="group"
        aria-label={ariaLabel ?? title}
        className="inline-flex rounded-xl bg-surface/80 p-0.5 ring-1 ring-line/70"
      >
        {SHIFT_LATE_OPTIONS.map((option) => {
          const active = current === option.value
          const short =
            option.value === 0
              ? 'בזמן'
              : option.value === 60
                ? '60׳'
                : `${option.value}׳`
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={option.label}
              onClick={() => onChange(option.value)}
              className={`min-h-8 rounded-lg px-2 text-[11px] font-bold tabular-nums transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 ${
                active
                  ? option.value === 0
                    ? 'bg-ok text-white shadow-sm'
                    : 'bg-warn text-white shadow-sm'
                  : 'text-ink-soft hover:bg-card hover:text-ink'
              }`}
            >
              {short}
            </button>
          )
        })}
      </div>
    </div>
  )
}
