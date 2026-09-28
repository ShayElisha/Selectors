import type { AppData, Worker } from './types'

const SESSION_KEY = 'shibutzon-session'
const DRAFT_KEY = 'shibutzon-draft'
const SHIFT_STEP_KEY = 'shibutzon-shift-step'

export type AppModule = 'selectors' | 'inspectors'

export interface OrgModules {
  selectors: boolean
  inspectors: boolean
}

export interface SessionUser {
  id: string
  fullName: string
  phone: string
  token: string
  role: 'super_admin' | 'org_manager'
  orgId: string | null
  orgName: string | null
  modules: OrgModules
  module: AppModule | null
  isOrgManager: boolean
}

function cacheKey(user: Pick<SessionUser, 'orgId' | 'module'> | null): string | null {
  if (!user?.orgId || !user.module) return null
  return `shibutzon-app-data-v2:${user.orgId}:${user.module}`
}

export function loadSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionUser
    if (!parsed?.id || !parsed?.phone || !parsed?.token) return null
    if (parsed.role !== 'super_admin' && parsed.role !== 'org_manager') return null
    const modules = {
      selectors: Boolean(parsed.modules?.selectors),
      inspectors: Boolean(parsed.modules?.inspectors),
    }
    const module =
      parsed.module === 'selectors' || parsed.module === 'inspectors'
        ? parsed.module
        : null
    if (parsed.role === 'org_manager' && (!parsed.orgId || !module || !modules[module])) {
      return null
    }
    const isOrgManager =
      typeof parsed.isOrgManager === 'boolean'
        ? parsed.isOrgManager
        : Boolean(modules.selectors && modules.inspectors)
    return {
      ...parsed,
      orgId: parsed.orgId || null,
      orgName: parsed.orgName || null,
      modules,
      module,
      isOrgManager,
    }
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
  return {
    id: w.id,
    fullName: w.fullName,
    phone: w.phone,
    token,
    role: 'org_manager',
    orgId: null,
    orgName: null,
    modules: { selectors: true, inspectors: false },
    module: 'selectors',
    isOrgManager: false,
  }
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
    const key = cacheKey(loadSession())
    if (!key) return null
    const raw = localStorage.getItem(key)
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
      shiftModels: Array.isArray(parsed.shiftModels) ? parsed.shiftModels : [],
      revision: Number(parsed.revision) || 0,
    }
  } catch {
    return null
  }
}

export function saveAppDataCache(data: AppData): void {
  try {
    const key = cacheKey(loadSession())
    if (!key) return
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    /* quota / private mode */
  }
}

export function clearAppDataCache(): void {
  const key = cacheKey(loadSession())
  if (key) localStorage.removeItem(key)
}
