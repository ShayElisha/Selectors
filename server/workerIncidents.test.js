import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  readState,
  appendIncident,
  patchIncident,
  upsertTargetedWorkerNotice,
  appendAuditLog,
  requireWorkerActor,
  scopeForRequest,
} = vi.hoisted(() => ({
  readState: vi.fn(),
  appendIncident: vi.fn(),
  patchIncident: vi.fn(),
  upsertTargetedWorkerNotice: vi.fn(),
  appendAuditLog: vi.fn(),
  requireWorkerActor: vi.fn(),
  scopeForRequest: vi.fn(),
}))

vi.mock('./data.js', () => ({ readState, appendIncident, patchIncident }))
vi.mock('./workerNotices.js', () => ({ upsertTargetedWorkerNotice }))
vi.mock('./audit.js', () => ({ appendAuditLog }))
vi.mock('./workerPortal.js', () => ({ requireWorkerActor }))
vi.mock('./scope.js', () => ({ scopeForRequest }))

import {
  listWorkerIncidents,
  reviewWorkerFaultReport,
  submitWorkerFault,
} from './workerIncidents.js'

describe('worker fault reports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireWorkerActor.mockResolvedValue({
      actor: {
        id: 'w1',
        fullName: 'בודק א',
        phone: '0501111111',
      },
      scope: { orgId: 'org-1', module: 'inspectors' },
    })
    readState.mockResolvedValue({
      revision: 3,
      lanes: [{ id: 'lane-1', name: 'שער 1' }],
      workers: [
        { id: 'm1', fullName: 'מנהל', isManager: true, status: 'active' },
        { id: 'w1', fullName: 'בודק א', status: 'active' },
      ],
      incidents: [],
    })
    appendIncident.mockImplementation(async (incident) => ({
      data: { revision: 4, incidents: [incident] },
      incident,
    }))
    upsertTargetedWorkerNotice.mockResolvedValue(null)
    appendAuditLog.mockResolvedValue(undefined)
  })

  it('stores worker faults as pending_approval until a manager opens them', async () => {
    const created = await submitWorkerFault(
      {},
      {
        title: 'תקלה בשער',
        description: 'השער לא נפתח',
        severity: 'high',
        laneId: 'lane-1',
      },
    )

    expect(created.status).toBe('pending_approval')
    expect(created.kind).toBe('fault')
    expect(created.reportedByWorkerId).toBe('w1')
    expect(appendIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending_approval',
        kind: 'fault',
        title: 'תקלה בשער',
        reportedByWorkerId: 'w1',
      }),
      expect.objectContaining({
        scope: { orgId: 'org-1', module: 'inspectors' },
      }),
    )
    expect(upsertTargetedWorkerNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'דיווח תקלה ממתין לאישור',
        targetWorkerIds: ['m1'],
      }),
      { orgId: 'org-1', module: 'inspectors' },
    )
  })

  it('notifies the reporting worker when a manager approves the fault', async () => {
    scopeForRequest.mockResolvedValue({
      actor: { id: 'm1', fullName: 'מנהל משמרת' },
      scope: { orgId: 'org-1', module: 'inspectors' },
    })
    patchIncident.mockImplementation(async (id, mutator) => {
      const next = mutator({
        id,
        kind: 'fault',
        title: 'תקלה בשער',
        description: 'השער לא נפתח',
        severity: 'high',
        status: 'pending_approval',
        reportedByWorkerId: 'w1',
        reportedByName: 'בודק א',
        createdAt: '2026-10-29T12:00:00.000Z',
        createdBy: 'בודק א',
        updatedAt: '2026-10-29T12:00:00.000Z',
        updatedBy: 'בודק א',
      })
      return { data: { revision: 5, incidents: [next] }, incident: next }
    })

    const result = await reviewWorkerFaultReport({}, 'fault-1', {
      decision: 'approve',
    })

    expect(result.incident.status).toBe('open')
    expect(upsertTargetedWorkerNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'התקלה שדיווחתם אושרה',
        targetWorkerIds: ['w1'],
      }),
      { orgId: 'org-1', module: 'inspectors' },
    )
  })

  it('notifies the reporting worker when a manager rejects the fault', async () => {
    scopeForRequest.mockResolvedValue({
      actor: { id: 'm1', fullName: 'מנהל משמרת' },
      scope: { orgId: 'org-1', module: 'inspectors' },
    })
    patchIncident.mockImplementation(async (id, mutator) => {
      const next = mutator({
        id,
        kind: 'fault',
        title: 'רעש חזק',
        description: 'רעש ממנוע',
        severity: 'medium',
        status: 'pending_approval',
        reportedByWorkerId: 'w1',
        reportedByName: 'בודק א',
        createdAt: '2026-10-29T12:00:00.000Z',
        createdBy: 'בודק א',
        updatedAt: '2026-10-29T12:00:00.000Z',
        updatedBy: 'בודק א',
      })
      return { data: { revision: 6, incidents: [next] }, incident: next }
    })

    await reviewWorkerFaultReport({}, 'fault-2', {
      decision: 'reject',
      rejectionReason: 'לא רלוונטי',
    })

    expect(upsertTargetedWorkerNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'התקלה שדיווחתם נדחתה',
        body: expect.stringContaining('לא רלוונטי'),
        targetWorkerIds: ['w1'],
      }),
      { orgId: 'org-1', module: 'inspectors' },
    )
  })

  it('lists only the signed-in worker fault reports', async () => {
    readState.mockResolvedValue({
      revision: 1,
      lanes: [
        { id: 'lane-1', name: 'שער 1' },
        { id: 'gate-manager', name: 'מנהל שער' },
      ],
      incidents: [
        {
          id: 'a',
          kind: 'fault',
          title: 'שלי',
          description: 'תיאור',
          severity: 'medium',
          status: 'pending_approval',
          reportedByWorkerId: 'w1',
          createdAt: '2026-10-29T12:00:00.000Z',
          createdBy: 'בודק א',
          updatedAt: '2026-10-29T12:00:00.000Z',
          updatedBy: 'בודק א',
        },
        {
          id: 'b',
          kind: 'fault',
          title: 'של אחר',
          description: 'תיאור',
          severity: 'low',
          status: 'open',
          reportedByWorkerId: 'w2',
          createdAt: '2026-10-29T11:00:00.000Z',
          createdBy: 'בודק ב',
          updatedAt: '2026-10-29T11:00:00.000Z',
          updatedBy: 'בודק ב',
        },
      ],
    })

    const result = await listWorkerIncidents({})
    expect(result.incidents).toHaveLength(1)
    expect(result.incidents[0].id).toBe('a')
    expect(result.lanes.map((lane) => lane.id)).toEqual(['lane-1'])
  })
})
