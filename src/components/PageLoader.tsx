import { Skeleton } from './ui'

export function PageLoader({
  label = 'טוען נתונים…',
  fullScreen = false,
  centered = false,
  size = 'md',
  skeleton = false,
}: {
  label?: string
  fullScreen?: boolean
  /** Center in the available portal content area (mobile-friendly). */
  centered?: boolean
  size?: 'sm' | 'md'
  /** Show layout placeholders instead of a blank spinner-only screen. */
  skeleton?: boolean
}) {
  if (skeleton) {
    const body = (
      <div
        className="w-full max-w-3xl space-y-4"
        role="status"
        aria-label={label}
      >
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <div className="space-y-3 pt-2">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
        <span className="sr-only">{label}</span>
      </div>
    )
    if (fullScreen) {
      return (
        <div className="flex min-h-dvh flex-col items-stretch justify-start gap-4 px-4 py-8 sm:px-6">
          {body}
        </div>
      )
    }
    return <div className="px-1 py-2">{body}</div>
  }

  const loader = (
    <div
      className={size === 'sm' ? 'page-loader page-loader--sm' : 'page-loader'}
      role="status"
      aria-label={label}
    />
  )

  if (fullScreen) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
        {loader}
        {label ? (
          <p className="ui-body font-medium text-ink-soft">{label}</p>
        ) : null}
      </div>
    )
  }

  if (centered) {
    return (
      <div className="flex min-h-[min(70dvh,28rem)] w-full flex-col items-center justify-center gap-3 px-4 py-10">
        {loader}
        {label ? (
          <p className="text-sm font-medium text-ink-soft">{label}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="inline-flex items-center gap-2.5">
      {loader}
      {label ? <span className="ui-muted">{label}</span> : null}
    </div>
  )
}
