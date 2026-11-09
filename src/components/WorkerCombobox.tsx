import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { avatarColor } from '../lib/avatarColor'
import { TraineeBadge } from './ui'
import type { Worker } from '../types'

export interface WorkerChoice {
  worker: Worker
  description?: string
}

function workerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0]?.slice(0, 2) ?? '?'
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

export function WorkerCombobox({
  options,
  value,
  placeholder,
  ariaLabel,
  onChange,
  disabled = false,
  searchNoun = 'עובד',
}: {
  options: WorkerChoice[]
  value: string
  placeholder: string
  ariaLabel: string
  onChange: (workerId: string | null) => void
  disabled?: boolean
  searchNoun?: string
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
  const selected = options.find((option) => option.worker.id === value)
  const filtered = options.filter(({ worker, description }) =>
    `${worker.fullName} ${description ?? ''}`
      .toLocaleLowerCase('he')
      .includes(query.trim().toLocaleLowerCase('he')),
  )

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(360, window.innerWidth - 16)
    const height = Math.min(320, window.innerHeight - 16)
    let top = rect.bottom + 4
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 4)
    }
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setPosition({ top, left, width })
  }

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    updatePosition()
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false)
        setQuery('')
      }
    }
    const reposition = () => updatePosition()
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex((index) =>
      filtered.length === 0
        ? -1
        : Math.min(Math.max(index, -1), filtered.length - 1),
    )
  }, [filtered.length, query])

  const choose = (workerId: string | null) => {
    onChange(workerId)
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }

  const openList = () => {
    setActiveIndex(filtered.findIndex((option) => option.worker.id === value))
    setOpen(true)
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) =>
        filtered.length ? (index + 2) % (filtered.length + 1) - 1 : -1,
      )
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) =>
        filtered.length
          ? (index - 1 + filtered.length + 2) % (filtered.length + 1) - 1
          : -1,
      )
    } else if (event.key === 'Home' && filtered.length) {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End' && filtered.length) {
      event.preventDefault()
      setActiveIndex(filtered.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex < 0) choose(null)
      else if (filtered[activeIndex]) choose(filtered[activeIndex]!.worker.id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setQuery('')
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => {
          if (open) {
            setOpen(false)
            setQuery('')
          } else {
            openList()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openList()
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        className={`flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border bg-surface-2 px-2.5 text-start transition hover:border-brand/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-70 ${
          selected ? 'border-line' : 'border-dashed border-warn/50'
        }`}
      >
        <ChevronDown
          className={`size-4 shrink-0 text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
        {selected ? (
          <span
            aria-hidden
            className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${avatarColor(selected.worker.fullName)}`}
          >
            {workerInitials(selected.worker.fullName)}
          </span>
        ) : (
          <span className="inline-flex size-7 shrink-0 items-center justify-center">
            <span className="size-2 rounded-full bg-warn" aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {selected?.worker.fullName ?? placeholder}
        </span>
        {selected?.worker.trainingRole === 'trainee' ? (
          <TraineeBadge className="shrink-0" />
        ) : null}
        {selected?.description ? (
          <span className="hidden max-w-[35%] truncate text-xs text-ink-soft sm:block">
            {selected.description}
          </span>
        ) : null}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[500] overflow-hidden rounded-xl border border-line bg-card p-2 shadow-[var(--shadow-panel-hover)]"
              style={{ top: position.top, left: position.left, width: position.width }}
            >
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  type="search"
                  className="ui-field h-10 w-full ps-9 text-sm"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={`חיפוש ${searchNoun}`}
                  aria-label={`חיפוש ${searchNoun}`}
                  aria-controls={`${id}-listbox`}
                  aria-activedescendant={
                    `${id}-${activeIndex < 0 ? 'clear' : `option-${activeIndex}`}`
                  }
                />
              </label>
              <div
                id={`${id}-listbox`}
                role="listbox"
                aria-label={ariaLabel}
                className="mt-2 max-h-64 overflow-y-auto"
              >
                <button
                  id={`${id}-clear`}
                  type="button"
                  role="option"
                  aria-selected={!value}
                  onMouseEnter={() => setActiveIndex(-1)}
                  onClick={() => choose(null)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm text-ink-soft hover:bg-surface ${
                    activeIndex === -1 ? 'bg-surface' : ''
                  }`}
                >
                  <span className="inline-flex size-7 items-center justify-center">
                    <span className="size-2 rounded-full bg-warn" aria-hidden />
                  </span>
                  {placeholder}
                  {!value ? <Check className="ms-auto size-4" aria-hidden /> : null}
                </button>
                {filtered.map(({ worker, description }, index) => (
                  <button
                    id={`${id}-option-${index}`}
                    key={worker.id}
                    type="button"
                    role="option"
                    aria-selected={worker.id === value}
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(worker.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start hover:bg-surface ${
                      index === activeIndex ? 'bg-surface' : ''
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${avatarColor(worker.fullName)}`}
                    >
                      {workerInitials(worker.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">
                          {worker.fullName}
                        </span>
                        {worker.trainingRole === 'trainee' ? (
                          <TraineeBadge className="shrink-0" />
                        ) : null}
                      </span>
                      {description ? (
                        <span className="block truncate text-xs text-ink-soft">
                          {description}
                        </span>
                      ) : null}
                    </span>
                    {worker.id === value ? (
                      <Check className="size-4 shrink-0 text-brand" aria-hidden />
                    ) : null}
                  </button>
                ))}
                {filtered.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-ink-soft">
                    לא נמצאו תוצאות
                  </p>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
