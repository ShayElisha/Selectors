import { AlertTriangle, CheckCircle2, ChevronDown, Clock, MinusCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { INTENSITY_LABELS } from '../constants'
import { avatarColor } from '../lib/avatarColor'
import { workerWindowLabelFromTimes } from '../lib/shiftCatalog'
import {
  timingBadgeClass,
  type TimingBadge,
} from '../lib/shiftTimingBadges'
import type { Intensity, WorkerWindowPreset } from '../types'

/** Isolate LTR spans (times, ratios) inside RTL layout. */
export function Ltr({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <bdi dir="ltr" className={`tabular-nums ${className}`.trim()}>
      {children}
    </bdi>
  )
}

export function IntensityBadge({ intensity }: { intensity: Intensity }) {
  const styles: Record<
    Intensity,
    { wrap: string; Icon: typeof CheckCircle2 }
  > = {
    easy: {
      wrap: 'bg-easy-soft text-easy ring-easy/20',
      Icon: CheckCircle2,
    },
    medium: {
      wrap: 'bg-warn-soft text-warn ring-warn/20',
      Icon: MinusCircle,
    },
    hard: {
      wrap: 'bg-hard-soft text-hard ring-hard/20',
      Icon: AlertTriangle,
    },
  }
  const s = styles[intensity]
  const label = INTENSITY_LABELS[intensity]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ring-1 sm:gap-1.5 sm:px-2.5 sm:text-xs ${s.wrap}`}
      title={`עומס נתיב: ${label}`}
      aria-label={`עומס נתיב ${label}`}
    >
      <s.Icon className="size-3 shrink-0 sm:size-3.5" aria-hidden />
      {label}
    </span>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

export function TraineeBadge({
  className = '',
}: {
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent ring-1 ring-accent/25 ${className}`.trim()}
    >
      מתלמד
    </span>
  )
}

export function PersonChip({
  name,
  trainingRole,
}: {
  name: string
  trainingRole?: 'trainee' | 'mentor' | null
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line/80 bg-surface/80 py-0.5 pe-2.5 ps-0.5 text-[11px] font-medium text-ink sm:text-xs">
      <span
        className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold sm:size-6 sm:text-[10px] ${avatarColor(name)}`}
        aria-hidden
      >
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
      {trainingRole === 'trainee' ? <TraineeBadge /> : null}
    </span>
  )
}

export function StaffingBadge({
  assigned,
  standard,
}: {
  assigned: number
  standard: number
}) {
  const over = assigned > standard
  const under = assigned < standard
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Ltr className="font-semibold text-ink">
        {assigned}/{standard}
      </Ltr>
      {over && (
        <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-semibold text-warn ring-1 ring-warn/20 sm:text-[11px]">
          <AlertTriangle className="size-3" aria-hidden />
          מעל התקן
        </span>
      )}
      {under && (
        <span className="inline-flex items-center gap-1 rounded-full bg-hard-soft px-2 py-0.5 text-[10px] font-semibold text-hard ring-1 ring-hard/20 sm:text-[11px]">
          <AlertTriangle className="size-3" aria-hidden />
          חסר
        </span>
      )}
    </span>
  )
}

export function CertChips({ items }: { items: string[] }) {
  if (!items.length) {
    return <span className="ui-muted text-[11px] sm:text-xs">ללא</span>
  }
  return (
    <div className="flex flex-wrap gap-1 sm:gap-1.5">
      {items.map((c) => (
        <span
          key={c}
          className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-soft ring-1 ring-line/80 sm:px-2.5 sm:text-xs"
        >
          {c}
        </span>
      ))}
    </div>
  )
}

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className = '',
  printRoot = false,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  printRoot?: boolean
}) {
  return (
    <section
      className={`min-w-0 max-w-full rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel)] sm:p-6 ${printRoot ? 'print-shift-root' : ''} ${className}`.trim()}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-5">
        <div className="min-w-0">
          <h2 className="ui-title">{title}</h2>
          {subtitle ? <div className="ui-subtitle">{subtitle}</div> : null}
        </div>
        {actions ? (
          <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:w-auto sm:max-w-full no-print">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  )
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string
  text?: string
  action?: React.ReactNode
}) {
  return (
    <div className="ui-empty" role="status">
      <p className="ui-empty-title">{title}</p>
      {text ? <p className="ui-empty-text">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`ui-skeleton ${className}`} aria-hidden />
}

export function TimingBadges({
  badges,
}: {
  badges: TimingBadge[]
}) {
  if (!badges.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badges.map((badge) => (
        <span
          key={`${badge.kind}-${badge.shortLabel}`}
          title={badge.label}
          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${timingBadgeClass(badge.kind)}`}
        >
          {badge.shortLabel}
        </span>
      ))}
    </span>
  )
}

export function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode
  htmlFor?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-medium text-ink-soft"
    >
      {children}
    </label>
  )
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p className="ui-field-error" role="alert">
      {message}
    </p>
  )
}

export function MetricIconBadge({
  children,
  tone = 'brand',
}: {
  children: React.ReactNode
  tone?: 'brand' | 'ok' | 'accent' | 'mid' | 'warn' | 'hard'
}) {
  const tones: Record<string, string> = {
    brand: 'bg-brand/8 text-brand ring-brand/10',
    ok: 'bg-ok-soft text-ok ring-ok/15',
    accent: 'bg-accent-soft text-accent ring-accent/15',
    mid: 'bg-mid-soft text-mid ring-mid/15',
    warn: 'bg-warn-soft text-warn ring-warn/15',
    hard: 'bg-hard-soft text-hard ring-hard/15',
  }
  return (
    <span
      className={`inline-flex size-9 items-center justify-center rounded-xl ring-1 sm:size-10 ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      <div
        ref={sheetRef}
        className="w-full max-w-2xl animate-slide-up rounded-t-3xl border-t border-line bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card px-5 py-4">
          <h3 id="sheet-title" className="text-base font-semibold text-ink">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface hover:text-ink"
            aria-label="סגור"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

export function WorkerHoursChip({
  value,
  presets,
  onChange,
  label,
  disabled = false,
}: {
  value: string | null | undefined
  presets: WorkerWindowPreset[]
  onChange: (id: string | null) => void
  label: string
  disabled?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedPreset = presets.find((p) => p.id === value)
  const displayText = selectedPreset?.label || 'כל המשמרת'
  const isCustom = !!selectedPreset

  const chipStyles = isCustom
    ? 'bg-brand/10 text-brand border-brand/30 ring-brand/20'
    : 'bg-surface text-ink-soft border-line/60 ring-line/20'

  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(true)}
        disabled={disabled}
        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium shadow-sm ring-1 transition-all hover:ring-2 focus:outline-none focus:ring-2 disabled:opacity-50 sm:min-h-[44px] sm:gap-2 sm:px-3.5 sm:text-[13px] ${chipStyles}`}
        aria-label={`${label}: ${displayText}`}
        title={label}
      >
        <Clock className="size-3.5 shrink-0 sm:size-4" aria-hidden />
        <span className="whitespace-nowrap">{displayText}</span>
        <ChevronDown className="size-3 shrink-0 opacity-70 sm:size-3.5" aria-hidden />
      </button>

      <BottomSheet
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="שעות משמרת"
      >
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setIsOpen(false)
            }}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-start text-sm font-medium transition-all hover:bg-surface ${
              !value
                ? 'border-brand bg-brand/5 text-brand'
                : 'border-line bg-card text-ink'
            }`}
          >
            <span>כל המשמרת</span>
            {!value && (
              <CheckCircle2 className="size-5 shrink-0 text-brand" aria-hidden />
            )}
          </button>

          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onChange(preset.id)
                setIsOpen(false)
              }}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-start transition-all hover:bg-surface ${
                value === preset.id
                  ? 'border-brand bg-brand/5'
                  : 'border-line bg-card'
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span
                  className={`text-sm font-medium ${
                    value === preset.id ? 'text-brand' : 'text-ink'
                  }`}
                >
                  {preset.label}
                </span>
                {Number.isFinite(preset.start) && Number.isFinite(preset.end) && (
                  <Ltr className="text-xs text-ink-soft">
                    {workerWindowLabelFromTimes(preset.start, preset.end)}
                  </Ltr>
                )}
              </div>
              {value === preset.id && (
                <CheckCircle2 className="size-5 shrink-0 text-brand" aria-hidden />
              )}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  )
}
