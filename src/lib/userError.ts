import { ApiError } from '../api'
import { notify } from './notify'

/** Extract a safe Hebrew-facing message from any thrown value. */
export function userErrorMessage(
  error: unknown,
  fallback = 'אירעה שגיאה. נסו שוב.',
): string {
  if (error instanceof ApiError) {
    const msg = String(error.message || '').trim()
    return msg || fallbackForStatus(error.status) || fallback
  }
  if (error instanceof Error) {
    const msg = String(error.message || '').trim()
    if (!msg) return fallback
    if (/failed to fetch|networkerror|load failed|econnrefused|enotfound/i.test(msg)) {
      return 'אין חיבור לשרת כרגע. בדקו את הרשת ונסו שוב.'
    }
    return msg
  }
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}

function fallbackForStatus(status: number): string | null {
  if (status === 401) return 'פג תוקף ההתחברות. התחברו מחדש.'
  if (status === 403) return 'אין הרשאה לבצע את הפעולה הזו.'
  if (status === 404) return 'הפריט לא נמצא או כבר נמחק.'
  if (status === 409) return 'הנתונים השתנו אצל מנהל אחר. רעננו ונסו שוב.'
  if (status === 429) return 'יותר מדי ניסיונות. המתינו רגע ונסו שוב.'
  if (status >= 500) return 'תקלה בשרת. נסו שוב בעוד רגע.'
  return null
}

/** Short title so the toast is scannable; details go in the description. */
export function userErrorTitle(
  message: string,
  status?: number,
): string {
  const text = String(message || '')
  if (status === 401 || /התחברות|פג תוקף|נדרשת התחברות/i.test(text)) {
    return 'נדרשת התחברות'
  }
  if (
    status === 409 ||
    /מנהל אחר עורך|עורך כרגע|במקביל|הנעילה אינה שייכת/.test(text)
  ) {
    return 'עריכה חסומה'
  }
  if (/השתנו|עודכנו ע״י|עודכנו ע"י|רעננו את המסך|התנגשות|קונפליקט/.test(text)) {
    return 'התנגשות נתונים'
  }
  if (/לא ניתן לשמור|לא ניתן לסגור|לא ניתן לנעול|לא שובצו|חתימה צריכה|שיבוץ כפול/.test(text)) {
    return 'לא ניתן להשלים'
  }
  if (/אין חיבור|חיבור מאובטח|offline|רשת|לשרת נכשל/i.test(text)) {
    return 'בעיית חיבור'
  }
  if (status === 403 || /אין הרשאה/.test(text)) return 'אין הרשאה'
  if (status === 404 || /לא נמצא/.test(text)) return 'לא נמצא'
  if (status != null && status >= 500) return 'תקלה בשרת'
  if (status != null && status >= 400) return 'הבקשה נדחתה'
  return 'שגיאה'
}

export function shouldOfferErrorRetry(message: string, status?: number): boolean {
  if (status === 401 || status === 403 || status === 404) return false
  if (/לא ניתן לשמור|לא ניתן לסגור|לא שובצו|חתימה צריכה|שיבוץ כפול|עורך כרגע|במקביל/.test(message)) {
    return false
  }
  return true
}

type ReportOptions = {
  /** Toast title override when classification is too generic. */
  title?: string
  /** Fallback body if `error` has no message. */
  fallback?: string
  /** Also return the resolved message for setError(...) callers. */
  silent?: boolean
}

/**
 * Show a clear error toast (title + details). Returns the body message
 * so callers can still `setError(message)` for the shell banner.
 */
export function reportUserError(
  error: unknown,
  options: ReportOptions = {},
): string {
  const status = error instanceof ApiError ? error.status : undefined
  const message = userErrorMessage(error, options.fallback)
  if (options.silent) return message
  const title = options.title || userErrorTitle(message, status)
  const description = message === title ? undefined : message
  notify.error(title, description)
  return message
}
