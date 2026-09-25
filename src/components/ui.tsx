import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react'
import { INTENSITY_LABELS } from '../constants'
import type { Intensity } from '../types'

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
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ring-1 sm:gap-1.5 sm:px-2.5 sm:text-xs ${s.wrap}`}
    >
      <s.Icon className="size-3 shrink-0 sm:size-3.5" aria-hidden />
      {INTENSITY_LABELS[intensity]}
    </span>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

export function PersonChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line/80 bg-surface/80 py-0.5 pe-2.5 ps-0.5 text-[11px] font-medium text-ink sm:text-xs">
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white sm:size-6 sm:text-[10px]"
        aria-hidden
      >
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
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
        <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn ring-1 ring-warn/20 sm:text-[11px]">
          <AlertTriangle className="size-3" aria-hidden />
          מעל התקן
        </span>
      )}
      {under && (
        <span className="inline-flex items-center gap-1 rounded-md bg-hard-soft px-1.5 py-0.5 text-[10px] font-semibold text-hard ring-1 ring-hard/20 sm:text-[11px]">
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
          className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-soft ring-1 ring-line/80 sm:px-2 sm:text-xs"
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
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  printRoot?: boolean
}) {
  return (
    <section
      className={`rounded-xl border border-line/70 bg-card/95 p-4 shadow-sm sm:rounded-2xl sm:p-6 ${printRoot ? 'print-shift-root' : ''} ${className}`.trim()}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-5">
        <div className="min-w-0">
          <h2 className="ui-title">{title}</h2>
          {subtitle ? <div className="ui-subtitle">{subtitle}</div> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 no-print">
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
      className="mb-1.5 block text-xs font-medium text-ink-soft sm:text-sm"
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
  tone?: 'brand' | 'ok' | 'accent' | 'mid' | 'warn'
}) {
  const tones: Record<string, string> = {
    brand: 'bg-brand/8 text-brand ring-brand/10',
    ok: 'bg-ok-soft text-ok ring-ok/15',
    accent: 'bg-accent-soft text-accent ring-accent/15',
    mid: 'bg-mid-soft text-mid ring-mid/15',
    warn: 'bg-warn-soft text-warn ring-warn/15',
  }
  return (
    <span
      className={`inline-flex size-9 items-center justify-center rounded-xl ring-1 sm:size-10 ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
