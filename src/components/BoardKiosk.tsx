import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Maximize2, Minimize2, RotateCw } from 'lucide-react'
import { Ltr } from './ui'

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
  }
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

function isPortraitPhone(): boolean {
  if (typeof window === 'undefined') return false
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 720
  return narrow && window.matchMedia('(orientation: portrait)').matches
}

export const BoardKiosk = forwardRef<
  BoardKioskHandle,
  {
    title: string
    subtitle?: ReactNode
    /** Normal page content (table / cards). Hidden while kiosk is active if `canvas` is set. */
    children: ReactNode
    /** Kiosk-only gate board. When set, replaces children in immersive mode. */
    canvas?: ReactNode
    className?: string
  }
>(function BoardKiosk(
  { title, subtitle, children, canvas, className = '' },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const [needsRotate, setNeedsRotate] = useState(false)
  const [clock, setClock] = useState(() => formatKioskClock(new Date()))

  const refreshOrientationHint = useCallback(() => {
    setNeedsRotate(isPortraitPhone())
  }, [])

  const enter = useCallback(async () => {
    setActive(true)
    refreshOrientationHint()
    const root = rootRef.current
    if (!root) return
    try {
      // Best-effort: many phones block Fullscreen API; immersive CSS still works.
      await requestElementFullscreen(root)
    } catch {
      /* overlay mode is enough on mobile */
    }
  }, [refreshOrientationHint])

  const exit = useCallback(async () => {
    setActive(false)
    setNeedsRotate(false)
    try {
      await exitDocumentFullscreen()
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const tick = () => setClock(formatKioskClock(new Date()))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [active])

  useEffect(() => {
    if (!active) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.classList.add('kiosk-immersive')
    refreshOrientationHint()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void exit()
    }
    const onOrient = () => refreshOrientationHint()
    window.addEventListener('keydown', onKey)
    window.addEventListener('orientationchange', onOrient)
    window.addEventListener('resize', onOrient)
    return () => {
      document.body.style.overflow = prevOverflow
      document.documentElement.classList.remove('kiosk-immersive')
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('orientationchange', onOrient)
      window.removeEventListener('resize', onOrient)
    }
  }, [active, exit, refreshOrientationHint])

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
      className={`board-kiosk ${active ? 'board-kiosk--active' : ''} ${
        canvas ? 'board-kiosk--has-canvas' : ''
      } ${className}`.trim()}
      aria-modal={active || undefined}
      role={active ? 'dialog' : undefined}
      aria-label={active ? 'מסך קיוסק' : undefined}
    >
      <div className="board-kiosk__chrome">
        <div className="min-w-0">
          <p className="board-kiosk__eyebrow">לוח שער חי</p>
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {title}
          </h2>
          {subtitle ? (
            <div className="mt-1 text-base text-ink-soft sm:text-lg">{subtitle}</div>
          ) : null}
        </div>
        <p className="board-kiosk__clock font-display text-3xl font-bold tabular-nums text-brand sm:text-4xl">
          <Ltr>{clock}</Ltr>
        </p>
        <button
          type="button"
          onClick={() => void exit()}
          className="board-kiosk__exit ui-btn ui-btn-secondary gap-2"
        >
          <Minimize2 className="size-4" aria-hidden />
          יציאה
        </button>
      </div>

      {active && needsRotate ? (
        <div className="board-kiosk__rotate" role="status">
          <RotateCw className="board-kiosk__rotate-icon" aria-hidden />
          <p className="board-kiosk__rotate-title">סובבו את המכשיר לרוחב</p>
          <p className="board-kiosk__rotate-text">
            מסך הקיוסק מותאם לצפייה אופקית בטלפון או בטלוויזיה
          </p>
          <button
            type="button"
            onClick={() => void exit()}
            className="board-kiosk__exit ui-btn ui-btn-secondary gap-2 mt-2"
          >
            <Minimize2 className="size-4" aria-hidden />
            יציאה
          </button>
        </div>
      ) : null}

      <div className="board-kiosk__body board-kiosk__desktop">{children}</div>
      {canvas ? <div className="board-kiosk__canvas">{canvas}</div> : null}
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
      title="הצגת הלוח במסך מלא לקיוסק, טלוויזיה או טלפון ברוחב"
    >
      <Maximize2 className="size-4" aria-hidden />
      מסך קיוסק
    </button>
  )
}
