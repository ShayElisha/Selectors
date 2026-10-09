import { describe, expect, it } from 'vitest'
import {
  applyBriefingStar,
  normalizeBriefingSections,
  normalizeQuestionBank,
  reindexOrders,
} from './briefings'

describe('briefings helpers', () => {
  it('normalizes and sorts sections', () => {
    const list = normalizeBriefingSections([
      { id: 'b', title: 'ב', body: '', order: 2, updatedAt: '1' },
      { id: 'a', title: 'א', body: 'x', order: 0, updatedAt: '1' },
      { id: '', title: 'bad', body: '', order: 1 },
    ])
    expect(list.map((s) => s.id)).toEqual(['a', 'b'])
    expect(list[0]!.body).toBe('x')
  })

  it('keeps starred sections at the top', () => {
    const list = normalizeBriefingSections([
      { id: 'b', title: 'ב', body: '', order: 0, updatedAt: '1' },
      { id: 'a', title: 'א', body: '', order: 1, updatedAt: '1', starred: true },
      { id: 'c', title: 'ג', body: '', order: 2, updatedAt: '1', starred: true },
    ])
    expect(list.map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(list[0]!.starred).toBe(true)
    expect(list[2]!.starred).toBeUndefined()
  })

  it('moves a newly starred section to the front and drops it when cleared', () => {
    const list = normalizeBriefingSections([
      { id: 'a', title: 'א', body: '', order: 0, updatedAt: '1', starred: true },
      { id: 'b', title: 'ב', body: '', order: 1, updatedAt: '1' },
      { id: 'c', title: 'ג', body: '', order: 2, updatedAt: '1' },
    ])
    const starred = applyBriefingStar(list, 'c', true)
    expect(starred.map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(starred.map((s) => s.order)).toEqual([0, 1, 2])
    const cleared = applyBriefingStar(starred, 'c', false)
    expect(cleared.map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(cleared[0]!.starred).toBe(true)
    expect(cleared[1]!.starred).toBeUndefined()
  })

  it('normalizes verbal answers and migrates legacy MCQ', () => {
    const list = normalizeQuestionBank([
      {
        id: 'q1',
        prompt: 'שאלה?',
        answer: 'תשובה מילולית',
        order: 0,
        updatedAt: '1',
      },
      {
        id: 'q2',
        prompt: 'ישנה?',
        options: ['א', 'ב'],
        correctIndex: 1,
        explanation: 'כי ב',
        order: 1,
        updatedAt: '1',
      },
      { id: 'q3', prompt: 'חסר', order: 2 },
    ])
    expect(list).toHaveLength(2)
    expect(list[0]!.answer).toBe('תשובה מילולית')
    expect(list[1]!.answer).toBe('ב — כי ב')
  })

  it('reindexes order', () => {
    expect(reindexOrders([{ order: 5 }, { order: 9 }]).map((x) => x.order)).toEqual([
      0, 1,
    ])
  })
})
