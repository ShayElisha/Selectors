import type { AppData, Worker } from './types'

const SESSION_KEY = 'shibutzon-session'
const DRAFT_KEY = 'shibutzon-draft'
const SHIFT_STEP_KEY = 'shibutzon-shift-step'
const APP_DATA_CACHE_KEY = 'shibutzon-app-data-v1'

export interface SessionUser {
  id: string
  fullName: string
  phone: string
  token: string
}

export function loadSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionUser
    if (!parsed?.id || !parsed?.phone || !parsed?.token) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSession(user: SessionUser): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

export function sessionFromWorker(w: Worker, token: string): SessionUser {
  return { id: w.id, fullName: w.fullName, phone: w.phone, token }
}

export function loadDraftJson(): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY)
  } catch {
    return null
  }
}

export function saveDraftJson(json: string): void {
  localStorage.setItem(DRAFT_KEY, json)
}

export function clearDraftStorage(): void {
  localStorage.removeItem(DRAFT_KEY)
  localStorage.removeItem(SHIFT_STEP_KEY)
}

export function loadShiftStep(): string | null {
  try {
    return localStorage.getItem(SHIFT_STEP_KEY)
  } catch {
    return null
  }
}

export function saveShiftStep(step: string): void {
  localStorage.setItem(SHIFT_STEP_KEY, step)
}

export function loadAppDataCache(): AppData | null {
  try {
    const raw = localStorage.getItem(APP_DATA_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AppData
    if (!Array.isArray(parsed?.workers) || !Array.isArray(parsed?.lanes)) return null
    return {
      workers: parsed.workers,
      lanes: parsed.lanes,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      certificationsCatalog: Array.isArray(parsed.certificationsCatalog)
        ? parsed.certificationsCatalog
        : [],
      briefingSections: Array.isArray(parsed.briefingSections)
        ? parsed.briefingSections
        : [],
      questionBank: Array.isArray(parsed.questionBank)
        ? parsed.questionBank
        : [],
      customsBrokers: Array.isArray(parsed.customsBrokers)
        ? parsed.customsBrokers
        : [],
      revision: Number(parsed.revision) || 0,
    }
  } catch {
    return null
  }
}

export function saveAppDataCache(data: AppData): void {
  try {
    localStorage.setItem(APP_DATA_CACHE_KEY, JSON.stringify(data))
  } catch {
    /* quota / private mode */
  }
}

export function clearAppDataCache(): void {
  localStorage.removeItem(APP_DATA_CACHE_KEY)
}
