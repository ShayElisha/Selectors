import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Ltr } from './ui'
import { notify } from '../lib/notify'

export type BoardKioskHandle = {
  enter: () => Promise<void>
  exit: () => Promise<void>
  active: boolean
}

function formatKioskClock(date: Date): string {
  return date.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

async function requestElementFullscreen(el: HTMLElement) {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void
  }
  if (typeof el.requestFullscreen === 'function') {
    await el.requestFullscreen()
    return
  }
  if (typeof anyEl.webkitRequestFullscreen === 'function') {
    await anyEl.webkitRequestFullscreen()
    return
  }
  throw new Error('fullscreen unsupported')
}

async function exitDocumentFullscreen() {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void
    webkitFullscreenElement?: Element | null
  }
  if (document.fullscreenElement && document.exitFullscreen) {
    await document.exitFullscreen()
    return
  }
  if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
    await doc.webkitExitFullscreen()
  }
}

function fullscreenElement(): Element | null {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null
  }
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

export const BoardKiosk = forwardRef<
  BoardKioskHandle,
  {
    title: string
    subtitle?: ReactNode
    children: ReactNode
    className?: string
  }
>(function BoardKiosk({ title, subtitle, children, className = '' }, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const [clock, setClock] = useState(() => formatKioskClock(new Date()))

  const syncActive = useCallback(() => {
    const root = rootRef.current
    setActive(Boolean(root && fullscreenElement() === root))
  }, [])

  useEffect(() => {
    document.addEventListener('fullscreenchange', syncActive)
    document.addEventListener('webkitfullscreenchange', syncActive)
    return () => {
      document.removeEventListener('fullscreenchange', syncActive)
      document.removeEventListener('webkitfullscreenchange', syncActive)
    }
  }, [syncActive])

  useEffect(() => {
    if (!active) return
    const tick = () => setClock(formatKioskClock(new Date()))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [active])

  const enter = useCallback(async () => {
    const root = rootRef.current
    if (!root) return
    try {
      await requestElementFullscreen(root)
      syncActive()
    } catch {
      notify.error('לא ניתן לפתוח מסך מלא בדפדפן זה')
    }
  }, [syncActive])

  const exit = useCallback(async () => {
    try {
      await exitDocumentFullscreen()
      syncActive()
    } catch {
      /* ignore */
    }
  }, [syncActive])

  useImperativeHandle(
    ref,
    () => ({
      enter,
      exit,
      active,
    }),
    [active, enter, exit],
  )

  return (
    <div
      ref={rootRef}
      className={`board-kiosk ${active ? 'board-kiosk--active' : ''} ${className}`.trim()}
    >
      <div className="board-kiosk__chrome">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {title}
          </h2>
          {subtitle ? (
            <div className="mt-1 text-base text-ink-soft sm:text-lg">{subtitle}</div>
          ) : null}
        </div>
        <p className="font-display text-3xl font-bold tabular-nums text-brand sm:text-4xl">
          <Ltr>{clock}</Ltr>
        </p>
        <button
          type="button"
          onClick={() => void exit()}
          className="board-kiosk__exit ui-btn ui-btn-secondary gap-2"
        >
          <Minimize2 className="size-4" aria-hidden />
          יציאה ממסך מלא
        </button>
      </div>
      <div className="board-kiosk__body">{children}</div>
    </div>
  )
})

export function BoardKioskEnterButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ui-btn ui-btn-secondary gap-2 no-print disabled:opacity-40"
      title="הצגת הלוח במסך מלא לקיוסק או טלוויזיה"
    >
      <Maximize2 className="size-4" aria-hidden />
      מסך קיוסק
    </button>
  )
}
