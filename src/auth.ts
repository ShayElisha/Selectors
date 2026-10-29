import type { AppData, ShiftAudience, StaffKind, Worker } from './types'

const SESSION_KEY = 'shibutzon-session'
const DRAFT_KEY = 'shibutzon-draft'
const SHIFT_STEP_KEY = 'shibutzon-shift-step'

export type AppModule = 'selectors' | 'inspectors' | 'security'

export interface OrgModules {
  selectors: boolean
  inspectors: boolean
  security: boolean
}

export const APP_MODULES: AppModule[] = ['selectors', 'inspectors', 'security']

export const MODULE_LABELS: Record<AppModule, string> = {
  selectors: 'סלקטורים',
  inspectors: 'בודקים',
  security: 'מאבטחים',
}

/** Singular/plural nouns for error toasts and board copy per module. */
export type PeopleLabels = {
  singular: string
  plural: string
  thePlural: string
}

export function peopleLabelsForModule(
  module: AppModule | null | undefined,
): PeopleLabels {
  if (module === 'security') {
    return {
      singular: 'מאבטח',
      plural: 'מאבטחים',
      thePlural: 'המאבטחים',
    }
  }
  if (module === 'selectors') {
    return {
      singular: 'סלקטור',
      plural: 'סלקטורים',
      thePlural: 'הסלקטורים',
    }
  }
  return {
    singular: 'בודק',
    plural: 'בודקים',
    thePlural: 'הבודקים',
  }
}

export function emptyOrgModules(): OrgModules {
  return { selectors: false, inspectors: false, security: false }
}

export function normalizeOrgModules(raw: unknown): OrgModules {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    selectors: Boolean(src.selectors),
    inspectors: Boolean(src.inspectors),
    security: Boolean(src.security),
  }
}

export function isAppModule(value: unknown): value is AppModule {
  return value === 'selectors' || value === 'inspectors' || value === 'security'
}

export function audienceForModule(module: AppModule | null | undefined): ShiftAudience {
  if (module === 'inspectors') return 'inspector'
  if (module === 'security') return 'security'
  return 'selector'
}

export function staffKindForModule(module: AppModule | null | undefined): StaffKind {
  if (module === 'inspectors') return 'inspector'
  if (module === 'security') return 'security'
  return 'selector'
}

export function isStaffKind(value: unknown): value is StaffKind {
  return value === 'inspector' || value === 'selector' || value === 'security'
}

export function enabledModuleCount(modules: OrgModules): number {
  return APP_MODULES.reduce((sum, key) => sum + (modules[key] ? 1 : 0), 0)
}

export function defaultModule(modules: OrgModules): AppModule | null {
  for (const key of APP_MODULES) {
    if (modules[key]) return key
  }
  return null
}

export interface SessionUser {
  id: string
  fullName: string
  phone: string
  token: string
  role: 'super_admin' | 'org_manager' | 'worker'
  orgId: string | null
  orgName: string | null
  modules: OrgModules
  module: AppModule | null
  isOrgManager: boolean
  staffKind?: StaffKind | null
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
    if (
      parsed.role !== 'super_admin' &&
      parsed.role !== 'org_manager' &&
      parsed.role !== 'worker'
    ) {
      return null
    }
    const modules = normalizeOrgModules(parsed.modules)
    const module = isAppModule(parsed.module) ? parsed.module : null
    if (
      (parsed.role === 'org_manager' || parsed.role === 'worker') &&
      (!parsed.orgId || !module || !modules[module])
    ) {
      return null
    }
    const isOrgManager =
      parsed.role === 'worker'
        ? false
        : typeof parsed.isOrgManager === 'boolean'
          ? parsed.isOrgManager
          : enabledModuleCount(modules) >= 2
    return {
      ...parsed,
      orgId: parsed.orgId || null,
      orgName: parsed.orgName || null,
      modules,
      module,
      isOrgManager,
      staffKind: isStaffKind(parsed.staffKind) ? parsed.staffKind : null,
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
    modules: { selectors: true, inspectors: false, security: false },
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
