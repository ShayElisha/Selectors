import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Menu rendered on document.body so table overflow and later cards cannot cover it.
 */
export function AnchoredMenu({
  open,
  anchorRef,
  children,
  width = 176,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  width?: number
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const panelHeight = 140
      let left = rect.left
      if (left + width > window.innerWidth - 8) {
        left = window.innerWidth - width - 8
      }
      if (left < 8) left = 8
      let top = rect.bottom + 6
      if (top + panelHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - panelHeight - 6)
      }
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, width])

  if (!open || !pos) return null

  return createPortal(
    <div
      role="menu"
      className="fixed z-[300] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--shadow-panel-hover)]"
      style={{ top: pos.top, left: pos.left, minWidth: width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}
