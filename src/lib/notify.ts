import { toast } from 'sonner'

const DEFAULT_DURATION = 3200
/** Default undo for medium edits (slot change, notes, add lane). */
export const UNDO_TOAST_MS = 5000
/** Longer undo for destructive / structure-changing board actions. */
export const UNDO_TOAST_MAJOR_MS = 8000
const ERROR_DURATION = 8000

type UndoOptions = {
  /** Use the longer countdown (default for board-wide actions). */
  major?: boolean
  description?: string
}

/** App-wide notifications via Sonner (success / error / info / warning). */
export const notify = {
  success(message: string, description?: string) {
    return toast.success(message, {
      description,
      duration: DEFAULT_DURATION,
    })
  },
  error(message: string, description?: string) {
    return toast.error(message, {
      description,
      duration: ERROR_DURATION,
    })
  },
  info(message: string, description?: string) {
    return toast.info(message, {
      description,
      duration: DEFAULT_DURATION,
    })
  },
  warning(message: string, description?: string) {
    return toast.warning(message, {
      description,
      duration: 4500,
    })
  },
  message(message: string, description?: string) {
    return toast(message, {
      description,
      duration: DEFAULT_DURATION,
    })
  },
  /**
   * Toast with a countdown bar and a ביטול action.
   * Pass `{ major: true }` for 8s (auto-assign, rebuild rounds, delete lane).
   */
  undoable(
    message: string,
    onUndo: () => void,
    descriptionOrOpts?: string | UndoOptions,
    maybeOpts?: UndoOptions,
  ) {
    const opts: UndoOptions =
      typeof descriptionOrOpts === 'object' && descriptionOrOpts
        ? descriptionOrOpts
        : { ...(maybeOpts ?? {}), description: descriptionOrOpts as string | undefined }
    const major = opts.major === true
    const duration = major ? UNDO_TOAST_MAJOR_MS : UNDO_TOAST_MS
    const seconds = Math.round(duration / 1000)
    return toast(message, {
      description:
        opts.description ?? `אפשר לבטל תוך ${seconds} שניות`,
      duration,
      className: major ? 'undo-toast undo-toast--major' : 'undo-toast',
      action: {
        label: 'ביטול',
        onClick: () => onUndo(),
      },
    })
  },
}

export { toast }
