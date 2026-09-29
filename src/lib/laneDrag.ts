import type { PointerEvent as ReactPointerEvent } from 'react'

/** Mouse and touch reorder. The row element must set data-lane-row to its id. */
export function startLanePointerDrag(
  event: ReactPointerEvent<HTMLElement>,
  id: string,
  move: (fromId: string, toId: string) => void,
) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  const handle = event.currentTarget
  handle.setPointerCapture(event.pointerId)
  let over: string | null = null
  const onMove = (ev: PointerEvent) => {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)
    const row = hit?.closest('[data-lane-row]')
    const next = row?.getAttribute('data-lane-row') ?? null
    if (next && next !== id) over = next
  }
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
    if (over) move(id, over)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
}
