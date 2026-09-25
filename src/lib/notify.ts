import { toast } from 'sonner'

const DEFAULT_DURATION = 3200

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
      duration: 5000,
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
}

export { toast }
