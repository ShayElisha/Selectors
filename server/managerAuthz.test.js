import { describe, expect, it } from 'vitest'
import { assertOrgManagerEdits } from './data.js'

describe('assertOrgManagerEdits', () => {
  const shiftManager = { isOrgManager: false, role: 'org_manager' }
  const orgManager = { isOrgManager: true, role: 'org_manager' }
  const orgBoss = {
    id: 'boss',
    isManager: true,
    isOrgManager: true,
    status: 'active',
    email: 'boss@example.com',
  }

  it('blocks shift managers from promoting a worker to isManager', () => {
    expect(() =>
      assertOrgManagerEdits(
        [{ id: 'w1', isManager: true, isOrgManager: false }],
        [{ id: 'w1', isManager: false, isOrgManager: false }],
        shiftManager,
      ),
    ).toThrow(/מנהל ארגון/)
  })

  it('allows org managers to promote shift managers', () => {
    expect(() =>
      assertOrgManagerEdits(
        [{ id: 'w1', isManager: true, isOrgManager: false }],
        [{ id: 'w1', isManager: false, isOrgManager: false }],
        orgManager,
      ),
    ).not.toThrow()
  })

  it('blocks shift managers from changing isOrgManager', () => {
    expect(() =>
      assertOrgManagerEdits(
        [{ id: 'w1', isManager: true, isOrgManager: true }],
        [{ id: 'w1', isManager: true, isOrgManager: false }],
        shiftManager,
      ),
    ).toThrow(/מנהל ארגון/)
  })

  it('allows shift managers to change an org manager email', () => {
    expect(() =>
      assertOrgManagerEdits(
        [{ ...orgBoss, email: 'new@example.com' }],
        [orgBoss],
        shiftManager,
      ),
    ).not.toThrow()
  })

  it('blocks shift managers from deleting an org manager', () => {
    expect(() =>
      assertOrgManagerEdits([], [orgBoss], shiftManager),
    ).toThrow(/למחוק מנהל ארגון/)
  })

  it('blocks shift managers from deactivating an org manager', () => {
    expect(() =>
      assertOrgManagerEdits(
        [{ ...orgBoss, status: 'inactive' }],
        [orgBoss],
        shiftManager,
      ),
    ).toThrow(/להשבית מנהל ארגון/)
  })

  it('allows org managers to delete another org manager row', () => {
    expect(() => assertOrgManagerEdits([], [orgBoss], orgManager)).not.toThrow()
  })
})
