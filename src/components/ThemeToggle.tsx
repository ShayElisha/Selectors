import { useEffect, useRef, useState } from 'react'
import { Coffee, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeMode } from '../lib/theme'

const OPTIONS: { id: ThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'בהיר', hint: 'כחול קר', icon: Sun },
  { id: 'dark', label: 'כהה', hint: 'לילה', icon: Moon },
  { id: 'warm', label: 'חם', hint: 'חום ובז׳', icon: Coffee },
]

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = OPTIONS.find((option) => option.id === theme) ?? OPTIONS[0]!
  const CurrentIcon = current.icon

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`ערכת צבעים: ${current.label}. ${current.hint}`}
        title={`${current.label} · ${current.hint}`}
        className="inline-flex size-9 items-center justify-center rounded-full border border-line/80 bg-card/90 text-ink shadow-sm transition hover:border-brand/30 hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <CurrentIcon className="size-4" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute end-0 top-full z-[80] mt-1.5 min-w-[9.5rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)]"
        >
          {OPTIONS.map((option) => {
            const Icon = option.icon
            const active = option.id === theme
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(option.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-start transition ${
                  active
                    ? 'bg-brand/8 text-brand'
                    : 'text-ink hover:bg-surface'
                }`}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="block text-[11px] text-ink-soft">{option.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
