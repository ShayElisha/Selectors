import { describe, expect, it } from 'vitest'
import { workerPlacementKey } from './workerAlerts.js'

describe('workerPlacementKey', () => {
  it('detects lane moves', () => {
    const before = {
      assignments: [{ laneId: 'a', workerIds: ['w1'] }],
    }
    const after = {
      assignments: [{ laneId: 'b', workerIds: ['w1'] }],
    }
    expect(workerPlacementKey(before, 'w1')).not.toEqual(
      workerPlacementKey(after, 'w1'),
    )
  })

  it('includes rounds and gate', () => {
    const shift = {
      gateManagerWorkerId: 'w2',
      rounds: [
        {
          label: '06:00–08:00',
          assignments: [{ laneId: 'x', workerIds: ['w1'] }],
        },
      ],
    }
    expect(workerPlacementKey(shift, 'w1')).toContain('round:')
    expect(workerPlacementKey(shift, 'w2')).toBe('gate')
  })
})
