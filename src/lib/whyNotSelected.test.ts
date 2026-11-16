import { describe, expect, it } from 'vitest'
import { explainWhyNotSelected } from './whyNotSelected'
import type { Lane, Worker } from '../types'

const lane: Lane = {
  id: 'l1',
  name: 'נתיב',
  intensity: 'medium',
  requiredCertifications: ['מכס'],
  staffingStandard: 1,
}

const workers: Worker[] = [
  {
    id: 'a',
    fullName: 'עם הסמכה',
    phone: '0500000001',
    certifications: ['מכס'],
    status: 'active',
    isInspector: true,
    isManager: false,
  },
  {
    id: 'b',
    fullName: 'בלי הסמכה',
    phone: '0500000002',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
  },
]

describe('explainWhyNotSelected', () => {
  it('explains missing certification', () => {
    const rows = explainWhyNotSelected({
      lane,
      presentWorkers: workers,
      selectedWorkerIds: ['a'],
    })
    expect(rows[0]?.workerName).toBe('בלי הסמכה')
    expect(rows[0]?.reasons.some((r) => r.includes('הסמכה'))).toBe(true)
  })
})
