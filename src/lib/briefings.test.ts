import { describe, expect, it } from 'vitest'
import {
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
