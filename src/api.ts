import type { AppData, ShiftHandoffNote, ShiftSchedule, ShiftVersionSummary } from './types'
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

export function fetchAppData(
  module?: 'selectors' | 'inspectors' | 'security',
  knownRevision?: number,
): Promise<AppData | { unchanged: true; revision: number }> {
  const headers: Record<string, string> = {}
  if (module) headers['X-App-Module'] = module
  if (knownRevision != null && Number.isFinite(knownRevision)) {
    headers['X-Known-Revision'] = String(knownRevision)
  }
  return request<AppData | { unchanged: true; revision: number }>('/api/data', {
    headers,
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

export function fetchShiftVersionsRemote(
  shiftId: string,
): Promise<ShiftVersionSummary[]> {
  return request<ShiftVersionSummary[]>(
    `/api/shifts/${encodeURIComponent(shiftId)}/versions`,
  )
}

export function restoreShiftVersionRemote(
  shiftId: string,
  versionId: string,
  expectedRevision?: number,
): Promise<AppData> {
  return request<AppData>(
    `/api/shifts/${encodeURIComponent(shiftId)}/versions/${encodeURIComponent(versionId)}/restore`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedRevision }),
    },
  )
}

export function fetchShiftHandoffs(): Promise<ShiftHandoffNote[]> {
  return request<ShiftHandoffNote[]>('/api/shift-handoffs')
}

export function createShiftHandoffRemote(
  body: Pick<ShiftHandoffNote, 'title' | 'details' | 'date' | 'shiftType'> &
    Partial<Pick<ShiftHandoffNote, 'ownerWorkerId' | 'dueDate'>>,
): Promise<ShiftHandoffNote> {
  return request<ShiftHandoffNote>('/api/shift-handoffs', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateShiftHandoffRemote(
  id: string,
  body: Partial<Pick<ShiftHandoffNote, 'title' | 'details' | 'status' | 'date' | 'shiftType' | 'ownerWorkerId' | 'dueDate'>>,
): Promise<ShiftHandoffNote> {
  return request<ShiftHandoffNote>(`/api/shift-handoffs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteShiftHandoffRemote(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/shift-handoffs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
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

export function selfHealShiftRemote(
  id: string,
  body: Record<string, unknown>,
  expectedRevision?: number,
): Promise<AppData> {
  return request<AppData>(`/api/shifts/${id}/self-heal`, {
    method: 'POST',
    body: JSON.stringify({ ...body, expectedRevision }),
  })
}

export type LoginNextStep =
  | 'login'
  | 'change_password'
  | 'await_email'
  | 'pending_approval'
  | 'rejected'
  | 'suspended'
  | 'no_modules'

export type LoginResponse =
  | (SessionUser & { token: string })
  | {
      next: LoginNextStep | 'verify_email'
      phone?: string
      message?: string
      challengeId?: string
      emailHint?: string
    }

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
): Promise<LoginResponse> {
  return request<LoginResponse>('/api/login', {
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

export function verifyLoginCodeRemote(
  challengeId: string,
  code: string,
): Promise<SessionUser & { token: string }> {
  return request('/api/login/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, code }),
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
  modules: { selectors: boolean; inspectors: boolean; security: boolean }
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
    modules?: { selectors?: boolean; inspectors?: boolean; security?: boolean }
    /** Super-admin: set/update org manager MFA email */
    managerEmail?: string
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

export interface BugReportSummary {
  id: string
  at: string
  title: string
  details: string
  where: string
  contactName: string
  contactPhone: string
  orgName: string
  handled: boolean
  handledAt: string
}

export function fetchBugReportsRemote(): Promise<BugReportSummary[]> {
  return request('/api/bug-reports')
}

export function setBugReportHandledRemote(
  id: string,
  handled: boolean,
): Promise<BugReportSummary> {
  return request(`/api/bug-reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ handled }),
  })
}

export interface SystemMessage {
  id: string
  title: string
  body: string
  at: string
}

export function fetchSystemMessagesRemote(): Promise<SystemMessage[]> {
  return request('/api/system-messages')
}

export function createSystemMessageRemote(body: {
  title: string
  body: string
}): Promise<SystemMessage> {
  return request('/api/system-messages', {
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

export interface OrgPortalContact {
  id: string
  name: string
  role: string
  phone: string
}

export interface OrgProfile {
  name: string
  logo: string
  portalContacts?: OrgPortalContact[]
}

export interface OrgAssignmentSettings {
  modules: { selectors: boolean; inspectors: boolean; security: boolean }
  assignmentModes: {
    selectors: 'rounds' | 'single'
    inspectors: 'rounds' | 'single'
    security: 'rounds' | 'single'
  }
  roundMinutes?: { selectors: number; inspectors: number; security: number }
  staggerRounds?: { selectors: boolean; inspectors: boolean; security: boolean }
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
  assignmentModes?: {
    selectors: 'rounds' | 'single'
    inspectors: 'rounds' | 'single'
    security: 'rounds' | 'single'
  }
  roundMinutes?: { selectors: number; inspectors: number; security: number }
  staggerRounds?: { selectors: boolean; inspectors: boolean; security: boolean }
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

export interface SystemErrorEntry {
  id: string
  at: string
  source: 'server' | 'client'
  status: number
  method: string
  path: string
  message: string
  stack: string
  actor: { id: string; role: string } | null
  orgId?: string
  module?: string
}

export interface SystemErrorPage {
  total: number
  offset: number
  limit: number
  items: SystemErrorEntry[]
}

export function fetchSystemErrorsRemote(
  limit = 50,
  offset = 0,
): Promise<SystemErrorPage> {
  return request<SystemErrorPage>(
    `/api/admin/errors?limit=${limit}&offset=${offset}`,
  )
}

export function postClientErrorRemote(error: {
  message: string
  stack?: string
  path: string
}): Promise<{ id: string }> {
  return request('/api/client-errors', {
    method: 'POST',
    body: JSON.stringify(error),
  })
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

export interface WorkerHomeResponse {
  me: {
    id: string
    fullName: string
    phone: string
    email: string
    certifications: string[]
    staffKind: 'inspector' | 'selector' | 'security'
    status: string
  }
  module: 'selectors' | 'inspectors' | 'security'
  slot: {
    date: string
    shiftType: string
    windowLabel: string
    startMinutes?: number | null
    endMinutes?: number | null
  }
  shift: {
    id: string
    date: string
    shiftType: string
    audience?: string
    assignmentMode?: string
    signOff?: unknown
    updatedAt?: string
  } | null
  placement: {
    lanes: {
      laneId: string
      laneName: string
      intensity: string
      notes: string
      workerIds: string[]
      mine: boolean
    }[]
    rounds: {
      label: string
      startMinutes: number
      endMinutes: number
      cohort?: string
      assignments: {
        laneId: string
        laneName: string
        intensity: string
        notes: string
        workerIds: string[]
        mine: boolean
      }[]
    }[] | null
  }
  gateManager: { id: string; fullName: string; phone: string } | null
  now?: {
    phase: 'upcoming' | 'active' | 'none' | string
    serverNow: string
    clockMinutes: number
    currentRound: {
      label: string
      startMinutes: number
      endMinutes: number
      cohort?: string | null
      lanes: {
        laneId: string
        laneName: string
        intensity: string
        notes: string
      }[]
      minutesRemaining: number
      endsAt: string
    } | null
    activeLanes: {
      laneId: string
      laneName: string
      intensity: string
      notes: string
    }[]
    minutesToRoundEnd: number | null
    roundEndsAt: string | null
    minutesToShiftStart: number | null
    shiftStartsAt: string | null
    minutesToShiftEnd: number | null
    shiftEndsAt: string | null
    shiftStartMinutes: number
    shiftEndMinutes: number
  }
  status: {
    present: boolean
    lateMinutes: number | null
    earlyMinutes: number | null
    earlyLeaveAt: number | null
    drop: {
      workerId: string
      kind: string
      minutes: number
      reason: string
    } | null
  }
  briefings: {
    id: string
    title: string
    body: string
    order: number
    starred?: boolean
    updatedAt?: string
  }[]
  questions: { id: string; prompt: string; answer: string; order: number }[]
}

export function fetchWorkerHomeRemote(): Promise<WorkerHomeResponse> {
  return request('/api/worker/home')
}

export interface WorkerHistoryResponse {
  fromDate: string
  toDate: string
  days: number
  shifts: {
    id: string
    date: string
    shiftType: string
    laneNames: string[]
    placement: WorkerHomeResponse['placement']
    present: boolean
    lateMinutes: number | null
    earlyMinutes: number | null
    earlyLeaveAt: number | null
    drop: {
      workerId?: string
      kind: string
      minutes: number
      reason: string
    } | null
    signedOff: boolean
    updatedAt?: string
  }[]
  cancellations: {
    shiftId: string
    date: string
    shiftType: string
    kind: string
    minutes: number
    reason: string
    laneIds: string[]
  }[]
  laneStats: {
    laneId: string
    laneName: string
    count: number
    byIntensity: { easy: number; medium: number; hard: number }
  }[]
  intensityStats: { easy: number; medium: number; hard: number }
  laneHistory: {
    date: string
    shiftType: string
    laneId: string
    laneName: string
    intensity: string
  }[]
}

export function fetchWorkerHistoryRemote(): Promise<WorkerHistoryResponse> {
  return request('/api/worker/history')
}

export interface WorkerContactItem {
  id: string
  name: string
  role: string
  phone: string
  phoneDigits: string
  kind:
    | 'gate_manager'
    | 'org_manager'
    | 'shift_manager'
    | 'coworker'
    | 'org_contact'
    | string
}

export function fetchWorkerContactsRemote(): Promise<{
  module: string
  orgName: string
  contacts: WorkerContactItem[]
}> {
  return request('/api/worker/contacts')
}

export interface WorkerNotificationItem {
  id: string
  source: 'manager' | 'system' | 'briefing' | 'assignment' | 'reminder' | string
  kind?: string
  title: string
  body: string
  at: string
  authorName: string
  read: boolean
  targeted?: boolean
}

export function fetchWorkerNotificationsRemote(): Promise<{
  items: WorkerNotificationItem[]
  unread: number
}> {
  return request('/api/worker/notifications')
}

export function markWorkerNotificationReadRemote(
  id: string,
): Promise<{ ok: boolean }> {
  return request(`/api/worker/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: '{}',
  })
}

export function markAllWorkerNotificationsReadRemote(): Promise<{
  ok: boolean
}> {
  return request('/api/worker/notifications/read-all', {
    method: 'POST',
    body: '{}',
  })
}

export function createWorkerNoticeRemote(body: {
  title: string
  body: string
}): Promise<WorkerNotificationItem> {
  return request('/api/worker/notices', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateWorkerStatusRemote(body: {
  kind: 'arrive'
}): Promise<WorkerHomeResponse> {
  return request('/api/worker/status', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export interface WorkerIncidentItem {
  id: string
  kind: 'fault' | 'event'
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status:
    | 'pending_approval'
    | 'rejected'
    | 'open'
    | 'in_progress'
    | 'resolved'
  laneId?: string
  shiftDate?: string
  shiftType?: string
  handlingNotes?: string
  reportedByWorkerId?: string
  reportedByName?: string
  approvedBy?: string
  approvedAt?: string
  rejectedBy?: string
  rejectedAt?: string
  rejectionReason?: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export function fetchWorkerIncidentsRemote(): Promise<{
  module: string
  incidents: WorkerIncidentItem[]
  lanes: { id: string; name: string }[]
}> {
  return request('/api/worker/incidents')
}

export function submitWorkerFaultRemote(body: {
  title: string
  description: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  laneId?: string
}): Promise<WorkerIncidentItem> {
  return request('/api/worker/incidents', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function reviewWorkerFaultRemote(
  id: string,
  body: {
    decision: 'approve' | 'reject'
    rejectionReason?: string
  },
): Promise<{ data: AppData; incident: WorkerIncidentItem }> {
  return request(`/api/incidents/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
