import { useEffect } from 'react'
import { registerUnsavedLeaveGuard } from './unsavedLeaveRegistry'

const LEAVE_MESSAGE = 'יש שינויים שלא נשמרו. לצאת בכל זאת?'

/** Browser tab close / refresh warning when `dirty` is true. */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}

/**
 * Register in-app leave confirmation + browser beforeunload for page forms.
 * Pass `active` when the form is open and dirty.
 */
export function usePageLeaveGuard(active: boolean) {
  useUnsavedChangesGuard(active)
  useEffect(() => {
    if (!active) return
    return registerUnsavedLeaveGuard(() => window.confirm(LEAVE_MESSAGE))
  }, [active])
}

/** Confirm before in-app navigation away from unsaved work. */
export function confirmLeaveUnsaved(dirty: boolean): boolean {
  if (!dirty) return true
  return window.confirm(LEAVE_MESSAGE)
}

export { LEAVE_MESSAGE }
