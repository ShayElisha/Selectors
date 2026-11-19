import { describe, expect, it } from 'vitest'
import { workerOperationEventsFor } from './workerPortal.js'

describe('workerOperationEventsFor', () => {
  it('returns only the current worker’s events and omits private actor details', () => {
    const shift = {
      shiftOperationEvents: [
        {
          id: 'mine',
          kind: 'worker_moved',
          workerId: 'worker-1',
          effectiveAt: '2025-01-01T08:00:00.000Z',
          recordedAt: '2025-01-01T08:10:00.000Z',
          fromLaneName: 'שער א',
          toLaneName: 'שער ב',
          actorName: 'מנהל',
        },
        {
          id: 'theirs',
          kind: 'worker_moved',
          workerId: 'worker-2',
          actorName: 'מנהל אחר',
        },
      ],
    }

    expect(workerOperationEventsFor(shift, 'worker-1')).toEqual([
      {
        id: 'mine',
        kind: 'worker_moved',
        effectiveAt: '2025-01-01T08:00:00.000Z',
        recordedAt: '2025-01-01T08:10:00.000Z',
        fromLaneName: 'שער א',
        toLaneName: 'שער ב',
      },
    ])
  })
})
