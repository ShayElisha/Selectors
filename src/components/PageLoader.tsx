export function PageLoader({
  label = 'טוען נתונים…',
  fullScreen = false,
  size = 'md',
}: {
  label?: string
  fullScreen?: boolean
  size?: 'sm' | 'md'
}) {
  const loader = (
    <div
      className={size === 'sm' ? 'page-loader page-loader--sm' : 'page-loader'}
      role="status"
      aria-label={label}
    />
  )

  if (!fullScreen) {
    return (
      <div className="inline-flex items-center gap-2.5">
        {loader}
        {label ? <span className="ui-muted">{label}</span> : null}
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4">
      {loader}
      <div className="text-center">
        <p className="ui-eyebrow mb-1.5">CHECK IN</p>
        <p className="ui-body font-medium text-ink-soft">{label}</p>
      </div>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2" aria-hidden>
        <div className="ui-skeleton mx-auto h-3 w-[75%]" />
        <div className="ui-skeleton h-3 w-full" />
        <div className="ui-skeleton mx-auto h-3 w-[85%]" />
      </div>
    </div>
  )
}
