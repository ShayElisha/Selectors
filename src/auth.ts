import type { AppData, ShiftAudience, StaffKind, Worker } from './types'
import {
  clearClientCacheKey,
  decryptClientPayload,
  encryptClientPayload,
  isEncryptedClientPayload,
} from './lib/clientCacheCrypto'

const SESSION_KEY = 'shibutzon-session'
/** Legacy plaintext draft key — wiped on save/clear, never read as trusted data. */
const DRAFT_KEY_LEGACY = 'shibutzon-draft'
const DRAFT_KEY = 'shibutzon-draft-v3'
const SHIFT_STEP_KEY = 'shibutzon-shift-step'
const APP_DATA_PREFIX_LEGACY = 'shibutzon-app-data-v2:'
const APP_DATA_PREFIX = 'shibutzon-app-data-v3:'

/** In-memory AppData snapshots — primary cache for navigation / 304. */
const memoryAppData = new Map<string, AppData>()
let memoryDraftJson: string | null = null
let memoryShiftStep: string | null = null

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

/** Dedicated employee-portal title per department. */
export const MODULE_PORTAL_LABELS: Record<AppModule, string> = {
  selectors: 'פורטל סלקטורים',
  inspectors: 'פורטל בודקים',
  security: 'פורטל מאבטחים',
}

export function moduleForStaffKind(
  kind: StaffKind | null | undefined,
): AppModule {
  if (kind === 'inspector') return 'inspectors'
  if (kind === 'security') return 'security'
  return 'selectors'
}

export function workerPortalHomePath(
  module: AppModule | null | undefined,
): string {
  const key = isAppModule(module) ? module : 'selectors'
  return `/portal/${key}`
}

export function workerPortalPath(
  module: AppModule | null | undefined,
  subPath = '',
): string {
  const base = workerPortalHomePath(module)
  const clean = String(subPath || '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  return clean ? `${base}/${clean}` : base
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
  rememberMe?: boolean
  /** Own profile photo as a data URL; absent/null → show initials. */
  avatarUrl?: string | null
}

function cacheKey(
  user: Pick<SessionUser, 'orgId' | 'module'> | null,
  prefix = APP_DATA_PREFIX,
): string | null {
  if (!user?.orgId || !user.module) return null
  return `${prefix}${user.orgId}:${user.module}`
}

function normalizeCachedAppData(parsed: AppData): AppData | null {
  if (!Array.isArray(parsed?.workers) || !Array.isArray(parsed?.lanes)) return null
  // Older cache entries omitted incidents; ignoring them forces a full server
  // pull so a later save cannot wipe the DB collection with [].
  if (!('incidents' in parsed) || !Array.isArray(parsed.incidents)) return null
  // Presets are part of the full-state PUT; an incomplete cache must never
  // turn a temporary offline read into an empty-catalog write.
  if (!Array.isArray(parsed.workerWindowPresets)) return null
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
    questionBank: Array.isArray(parsed.questionBank) ? parsed.questionBank : [],
    customsBrokers: Array.isArray(parsed.customsBrokers)
      ? parsed.customsBrokers
      : [],
    shiftModels: Array.isArray(parsed.shiftModels) ? parsed.shiftModels : [],
    workerWindowPresets: parsed.workerWindowPresets,
    incidents: parsed.incidents,
    revision: Number(parsed.revision) || 0,
  }
}

function removeLocalStorageKeys(match: (key: string) => boolean): void {
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && match(key)) toRemove.push(key)
    }
    for (const key of toRemove) localStorage.removeItem(key)
  } catch {
    /* private mode */
  }
}

export function loadSession(): SessionUser | null {
  try {
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(SESSION_KEY)
    } catch {
      /* session storage may be unavailable in restricted browser contexts */
    }
    if (!raw) {
      try {
        raw = localStorage.getItem(SESSION_KEY)
      } catch {
        /* local storage may be unavailable in restricted browser contexts */
      }
    }
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionUser
    if (!parsed?.id || !parsed?.phone) return null
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
    const avatarUrl =
      typeof parsed.avatarUrl === 'string' && parsed.avatarUrl
        ? parsed.avatarUrl
        : null
    return {
      ...parsed,
      token: 'cookie-session',
      orgId: parsed.orgId || null,
      orgName: parsed.orgName || null,
      modules,
      module,
      isOrgManager,
      staffKind: isStaffKind(parsed.staffKind) ? parsed.staffKind : null,
      rememberMe: parsed.rememberMe !== false,
      avatarUrl,
    }
  } catch {
    return null
  }
}

export function saveSession(user: SessionUser): void {
  const session = Object.fromEntries(
    Object.entries(user).filter(([key]) => key !== 'token'),
  )
  const serialized = JSON.stringify(session)
  if (user.rememberMe === true) {
    try {
      localStorage.setItem(SESSION_KEY, serialized)
    } catch {
      /* storage unavailable */
    }
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      /* storage unavailable */
    }
  } else {
    try {
      sessionStorage.setItem(SESSION_KEY, serialized)
    } catch {
      /* when session storage is blocked, do not persist an unchecked session */
    }
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      /* storage unavailable */
    }
  }
}

export function clearSession(): void {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      storage.removeItem(SESSION_KEY)
    } catch {
      /* private mode */
    }
  }
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

/** Sync read — memory only (encrypted disk is hydrated asynchronously). */
export function loadDraftJson(): string | null {
  return memoryDraftJson
}

export function saveDraftJson(json: string): void {
  memoryDraftJson = json
  try {
    localStorage.removeItem(DRAFT_KEY_LEGACY)
  } catch {
    /* ignore */
  }
  void (async () => {
    const encrypted = await encryptClientPayload(json)
    if (!encrypted) return
    try {
      localStorage.setItem(DRAFT_KEY, encrypted)
    } catch {
      /* quota / private mode */
    }
  })()
}

export function clearDraftStorage(): void {
  memoryDraftJson = null
  memoryShiftStep = null
  try {
    localStorage.removeItem(DRAFT_KEY)
    localStorage.removeItem(DRAFT_KEY_LEGACY)
    localStorage.removeItem(SHIFT_STEP_KEY)
  } catch {
    /* private mode */
  }
}

export function loadShiftStep(): string | null {
  if (memoryShiftStep) return memoryShiftStep
  try {
    return localStorage.getItem(SHIFT_STEP_KEY)
  } catch {
    return null
  }
}

export function saveShiftStep(step: string): void {
  memoryShiftStep = step
  try {
    localStorage.setItem(SHIFT_STEP_KEY, step)
  } catch {
    /* private mode */
  }
}

/** Restore encrypted draft + step into memory after login / page reload. */
export async function hydrateDraftStorage(): Promise<{
  draftJson: string | null
  shiftStep: string | null
}> {
  if (memoryDraftJson) {
    return { draftJson: memoryDraftJson, shiftStep: loadShiftStep() }
  }
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw && isEncryptedClientPayload(raw)) {
      const decrypted = await decryptClientPayload<string>(raw)
      if (typeof decrypted === 'string' && decrypted) {
        memoryDraftJson = decrypted
      }
    } else if (raw) {
      // Reject legacy plaintext drafts.
      localStorage.removeItem(DRAFT_KEY)
    }
    localStorage.removeItem(DRAFT_KEY_LEGACY)
  } catch {
    /* private mode */
  }
  return { draftJson: memoryDraftJson, shiftStep: loadShiftStep() }
}

/** Sync read — in-memory only. Use hydrateAppDataCache() for encrypted disk. */
export function loadAppDataCache(): AppData | null {
  const key = cacheKey(loadSession())
  if (!key) return null
  const remembered = memoryAppData.get(key)
  return remembered ? normalizeCachedAppData(remembered) : null
}

export function saveAppDataCache(data: AppData): void {
  const session = loadSession()
  const key = cacheKey(session)
  if (!key) return
  const normalized = normalizeCachedAppData(data)
  if (!normalized) return
  memoryAppData.set(key, normalized)
  // Drop legacy plaintext for this module only — never leave readable AppData on disk.
  const legacy = cacheKey(session, APP_DATA_PREFIX_LEGACY)
  try {
    if (legacy) localStorage.removeItem(legacy)
  } catch {
    /* private mode */
  }
  void (async () => {
    const encrypted = await encryptClientPayload(normalized)
    if (!encrypted) return
    try {
      localStorage.setItem(key, encrypted)
    } catch {
      /* quota / private mode */
    }
  })()
}

/** Decrypt the encrypted disk snapshot into memory (same browser tab session). */
export async function hydrateAppDataCache(): Promise<AppData | null> {
  const session = loadSession()
  const key = cacheKey(session)
  if (!key) return null
  const existing = memoryAppData.get(key)
  if (existing) return normalizeCachedAppData(existing)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      // Purge any leftover plaintext v2 for this org/module.
      const legacy = cacheKey(session, APP_DATA_PREFIX_LEGACY)
      if (legacy) localStorage.removeItem(legacy)
      return null
    }
    if (!isEncryptedClientPayload(raw)) {
      localStorage.removeItem(key)
      return null
    }
    const parsed = await decryptClientPayload<AppData>(raw)
    if (!parsed) return null
    const normalized = normalizeCachedAppData(parsed)
    if (!normalized) return null
    memoryAppData.set(key, normalized)
    return normalized
  } catch {
    return null
  }
}

/** Remove every module snapshot for the signed-in org (or all orgs if unknown). */
export function clearAppDataCache(): void {
  const session = loadSession()
  const orgId = session?.orgId
  if (orgId) {
    for (const key of [...memoryAppData.keys()]) {
      if (key.includes(`:${orgId}:`)) memoryAppData.delete(key)
    }
    removeLocalStorageKeys(
      (key) =>
        key.startsWith(`${APP_DATA_PREFIX}${orgId}:`) ||
        key.startsWith(`${APP_DATA_PREFIX_LEGACY}${orgId}:`),
    )
  } else {
    memoryAppData.clear()
    removeLocalStorageKeys(
      (key) =>
        key.startsWith(APP_DATA_PREFIX) ||
        key.startsWith(APP_DATA_PREFIX_LEGACY),
    )
  }
}

/** Full client wipe used on logout / 401 — session, drafts, and cached app data. */
export function clearClientAuthStorage(): void {
  clearAppDataCache()
  clearDraftStorage()
  clearClientCacheKey()
  clearSession()
  try {
    const doomed: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (
        key &&
        (key.startsWith('getin.worker.home.') ||
          key.startsWith('getin.worker.history.'))
      ) {
        doomed.push(key)
      }
    }
    for (const key of doomed) sessionStorage.removeItem(key)
  } catch {
    /* private mode */
  }
}
