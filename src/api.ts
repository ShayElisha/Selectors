import type { AppData, ShiftSchedule } from './types'
import { clearSession, loadAppDataCache, loadSession, type SessionUser } from './auth'

export class ApiError extends Error {
  status: number
  current?: AppData

  constructor(message: string, status: number, current?: AppData) {
    super(message)
    this.status = status
    this.current = current
  }
}

function authHeaders(): HeadersInit {
  const s = loadSession()
  const headers: Record<string, string> = {}
  if (s?.token) headers.Authorization = `Bearer ${s.token}`
  if (s?.module) headers['X-App-Module'] = s.module
  return headers
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...authHeaders(),
    ...(init?.headers ?? {}),
  }
  let res = await fetch(path, { ...init, headers })
  if (res.status === 304) {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET' && path === '/api/data') {
      const cached = loadAppDataCache()
      if (cached) return cached as T
    }
    res = await fetch(path, { ...init, cache: 'reload', headers })
  }
  if (!res.ok) {
    let message = `API error ${res.status}`
    let current: AppData | undefined
    try {
      const body = (await res.json()) as {
        error?: string
        current?: AppData
      }
      if (body?.error) message = body.error
      if (body?.current) current = body.current
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      clearSession()
    }
    throw new ApiError(message, res.status, current)
  }
  return res.json() as Promise<T>
}

export function fetchAppData(module?: 'selectors' | 'inspectors'): Promise<AppData> {
  return request<AppData>('/api/data', {
    headers: module ? { 'X-App-Module': module } : {},
  })
}

export function saveAppDataRemote(data: AppData): Promise<AppData> {
  const { revision, ...rest } = data
  return request<AppData>('/api/data', {
    method: 'PUT',
    body: JSON.stringify({ ...rest, expectedRevision: revision ?? 0 }),
  })
}

export function seedAppDataRemote(expectedRevision?: number): Promise<AppData> {
  return request<AppData>('/api/seed', {
    method: 'POST',
    body: JSON.stringify({
      confirm: 'RESET',
      expectedRevision,
    }),
  })
}

export function saveShiftRemote(
  schedule: ShiftSchedule,
  expectedRevision?: number,
): Promise<AppData> {
  return request<AppData>(`/api/shifts/${schedule.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...schedule, expectedRevision }),
  })
}

export function deleteShiftRemote(
  id: string,
  expectedRevision?: number,
): Promise<AppData> {
  const q =
    expectedRevision == null ? '' : `?expectedRevision=${expectedRevision}`
  return request<AppData>(`/api/shifts/${id}${q}`, { method: 'DELETE' })
}

export type LoginNextStep =
  | 'login'
  | 'change_password'
  | 'await_email'
  | 'pending_approval'
  | 'rejected'
  | 'suspended'
  | 'no_modules'

export function checkLoginRemote(
  phone: string,
): Promise<{ next: LoginNextStep; phone: string; message?: string }> {
  return request<{ next: LoginNextStep; phone: string; message?: string }>(
    '/api/login',
    {
      method: 'POST',
      body: JSON.stringify({ phone }),
    },
  )
}

export function loginRemote(
  phone: string,
  password: string,
  opts?: {
    newPassword?: string
    newPasswordConfirm?: string
  },
): Promise<
  | (SessionUser & { token: string })
  | { next: LoginNextStep; phone: string; message?: string }
> {
  return request('/api/login', {
    method: 'POST',
    body: JSON.stringify({
      phone,
      password,
      ...(opts?.newPassword !== undefined
        ? {
            newPassword: opts.newPassword,
            newPasswordConfirm: opts.newPasswordConfirm,
          }
        : {}),
    }),
  })
}

export function registerOrganizationRemote(body: {
  organizationName: string
  fullName: string
  phone: string
  email: string
  password: string
  passwordConfirm: string
}): Promise<{ ok: boolean; message: string }> {
  return request('/api/register', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export interface OrganizationSummary {
  id: string
  name: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended' | 'deleted'
  modules: { selectors: boolean; inspectors: boolean }
  createdAt: string
  approvedAt?: string
  rejectedAt?: string
  suspendedAt?: string
  lastLoginAt?: string
  deletedAt?: string
  restoreUntil?: string
  manager: { fullName: string; phone: string; email: string } | null
}

export function fetchOrganizationsRemote(): Promise<OrganizationSummary[]> {
  return request('/api/organizations')
}

export function deleteOrganizationRemote(id: string): Promise<{ ok: boolean }> {
  return request('/api/organizations', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
}

export function extendOrganizationRestoreRemote(
  id: string,
): Promise<OrganizationSummary> {
  return request('/api/organizations/extend-restore', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export function purgeOrganizationRemote(
  id: string,
  confirmName: string,
  password: string,
): Promise<{ ok: boolean }> {
  return request('/api/organizations/purge', {
    method: 'POST',
    body: JSON.stringify({ id, confirmName, password }),
  })
}

export function fetchHistoryPage(query: {
  limit: number
  offset: number
  from?: string
  to?: string
}): Promise<{ total: number; offset: number; limit: number; items: ShiftSchedule[] }> {
  const params = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  })
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  return request(`/api/history?${params.toString()}`)
}

export function restoreOrganizationRemote(id: string): Promise<OrganizationSummary> {
  return request('/api/organizations/restore', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export function reviewOrganizationRemote(
  id: string,
  patch: {
    status?: 'pending' | 'approved' | 'rejected' | 'suspended'
    modules?: { selectors?: boolean; inspectors?: boolean }
  },
): Promise<OrganizationSummary> {
  return request('/api/organizations', {
    method: 'PATCH',
    body: JSON.stringify({ id, ...patch }),
  })
}

export function changePasswordRemote(body: {
  currentPassword: string
  newPassword: string
  newPasswordConfirm: string
}): Promise<{ ok: boolean }> {
  return request('/api/password', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function submitBugReportRemote(body: {
  title: string
  details: string
  where?: string
  contactName?: string
  contactPhone?: string
}): Promise<{ ok: boolean; emailed: boolean }> {
  return request('/api/bug-reports', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function requestPasswordResetRemote(
  phone: string,
): Promise<{ ok: boolean; message: string }> {
  return request('/api/password-reset', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
}

export interface OrgProfile {
  name: string
  logo: string
}

export interface OrgAssignmentSettings {
  modules: { selectors: boolean; inspectors: boolean }
  assignmentModes: { selectors: 'rounds' | 'single'; inspectors: 'rounds' | 'single' }
  roundMinutes?: { selectors: number; inspectors: number }
  staggerRounds?: { selectors: boolean; inspectors: boolean }
  organization?: OrgProfile
}

export function refreshSessionRemote(): Promise<SessionUser & { token: string }> {
  return request('/api/session')
}

export function reportShiftPresence(shiftId: string): Promise<{ others: string[] }> {
  return request('/api/shift-presence', {
    method: 'POST',
    body: JSON.stringify({ shiftId }),
  })
}

export function fetchOrgSettings(): Promise<OrgAssignmentSettings> {
  return request<OrgAssignmentSettings>('/api/org-settings')
}

export function saveOrgSettings(body: {
  assignmentModes?: { selectors: 'rounds' | 'single'; inspectors: 'rounds' | 'single' }
  roundMinutes?: { selectors: number; inspectors: number }
  staggerRounds?: { selectors: boolean; inspectors: boolean }
  profile?: OrgProfile
}): Promise<OrgAssignmentSettings> {
  return request<OrgAssignmentSettings>('/api/org-settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function resendManagerTempPasswordRemote(
  workerId: string,
): Promise<{ ok: boolean }> {
  return request('/api/resend-temp-password', {
    method: 'POST',
    body: JSON.stringify({ workerId }),
  })
}

export interface AuditLogEntry {
  id: string
  at: string
  action: string
  actor: { id: string; fullName: string; phone: string } | null
  details: string
}

export function fetchAuditLogs(limit = 150): Promise<AuditLogEntry[]> {
  return request<AuditLogEntry[]>(`/api/audit?limit=${limit}`)
}

export type ClientAuditAction =
  | 'auto_assign'
  | 'manual_assign'
  | 'manual_swap'
  | 'lane_note'
  | 'export_board'

/** Fire-and-forget friendly: returns null on failure instead of throwing by default. */
export async function postAuditEvent(
  action: ClientAuditAction,
  details: string,
  opts?: { throwOnError?: boolean },
): Promise<AuditLogEntry | null> {
  try {
    return await request<AuditLogEntry>('/api/audit', {
      method: 'POST',
      body: JSON.stringify({ action, details }),
    })
  } catch (e) {
    if (opts?.throwOnError) throw e
    console.warn('audit log failed', e)
    return null
  }
}
