export function BrandMark({
  variant = 'mark',
  className = '',
}: {
  variant?: 'mark' | 'full'
  className?: string
}) {
  const full = variant === 'full'
  return (
    <img
      src={full ? '/shibutzon-logo.png' : '/apple-touch-icon.png'}
      alt="שיבוצון"
      className={`object-contain ${full ? 'h-28 w-auto' : 'size-10'} ${className}`}
    />
  )
}
