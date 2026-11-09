import { avatarColor } from '../lib/avatarColor'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

const SIZE_CLASS = {
  sm: 'size-7 text-[10px]',
  md: 'size-9 text-[11px]',
  lg: 'size-16 text-base',
} as const

export function UserAvatar({
  name,
  avatarUrl,
  size = 'sm',
  className = '',
}: {
  name: string
  avatarUrl?: string | null
  size?: keyof typeof SIZE_CLASS
  className?: string
}) {
  const box = SIZE_CLASS[size]
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`shrink-0 rounded-full object-cover ${box} ${className}`}
      />
    )
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-wide ${box} ${avatarColor(name)} ${className}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}
