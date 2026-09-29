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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      {loader}
      {label ? <p className="ui-body font-medium text-ink-soft">{label}</p> : null}
    </div>
  )
}
