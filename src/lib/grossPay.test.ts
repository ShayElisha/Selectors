import { describe, expect, it } from 'vitest'
import {
  buildMonthPay,
  holidayName,
  weekdayOf,
  yearQueryRange,
  type WorkEntry,
} from './grossPay'

function entry(
  date: string,
  start: string,
  end: string,
  id = `${date}-${start}`,
  kind?: WorkEntry['kind'],
): WorkEntry {
  return { id, date, start, end, ...(kind ? { kind } : {}) }
}

function dayOf(month: string, date: string, entries: WorkEntry[], amount = 60) {
  const result = buildMonthPay({
    month,
    basis: 'hourly',
    amount,
    entries,
  })
  const day = result.days.find((item) => item.date === date)
  if (!day) throw new Error(`missing ${date}`)
  return { result, day }
}

describe('yearQueryRange', () => {
  it('covers the whole year and the weeks that touch it', () => {
    const range = yearQueryRange(2026)
    expect(range.from <= '2026-01-01').toBe(true)
    expect(range.to >= '2026-12-31').toBe(true)
    expect(weekdayOf(range.from)).toBe(0)
    expect(weekdayOf(range.to)).toBe(6)
  })
})

describe('holidayName', () => {
  it('marks Israel rest days', () => {
    expect(holidayName('2026-09-12')).toBe('ראש השנה')
    expect(holidayName('2026-09-13')).toBe('ראש השנה')
    expect(holidayName('2026-09-21')).toBe('יום כיפור')
    expect(holidayName('2026-09-26')).toBe('סוכות')
    expect(holidayName('2026-10-03')).toBe('שמיני עצרת')
    expect(holidayName('2026-04-02')).toBe('פסח')
    expect(holidayName('2026-04-08')).toBe('שביעי של פסח')
    expect(holidayName('2026-05-22')).toBe('שבועות')
    expect(holidayName('2025-09-23')).toBe('ראש השנה')
    expect(holidayName('2026-09-20')).toBeNull()
  })
})

describe('buildMonthPay', () => {
  it('pays a regular day at 100% up to 8:24', () => {
    const { day } = dayOf('2026-11', '2026-11-01', [
      entry('2026-11-01', '08:00', '16:24'),
    ])
    expect(day.minutes).toEqual({
      regular: 504,
      ot125: 0,
      ot150: 0,
      shabbat: 0,
      holiday: 0,
    })
    expect(day.gross).toBe(504)
  })

  it('splits the next two hours at 125% and the rest at 150%', () => {
    const { day } = dayOf('2026-11', '2026-11-01', [
      entry('2026-11-01', '08:00', '20:00'),
    ])
    expect(day.minutes.regular).toBe(504)
    expect(day.minutes.ot125).toBe(120)
    expect(day.minutes.ot150).toBe(96)
    expect(day.gross).toBe(798)
  })

  it('pays Saturday at 150%', () => {
    const { day } = dayOf('2026-11', '2026-11-07', [
      entry('2026-11-07', '08:00', '12:00'),
    ])
    expect(day.weekday).toBe(6)
    expect(day.minutes.shabbat).toBe(240)
    expect(day.gross).toBe(360)
  })

  it('splits Friday at 16:00 between a short day and Shabbat', () => {
    const { day } = dayOf('2026-11', '2026-11-06', [
      entry('2026-11-06', '14:00', '20:00'),
    ])
    expect(day.minutes.regular).toBe(120)
    expect(day.minutes.shabbat).toBe(240)
    expect(day.gross).toBe(480)
    expect(day.entries).toEqual([
      {
        id: '2026-11-06-14:00',
        originDate: '2026-11-06',
        from: '14:00',
        to: '20:00',
      },
    ])
  })

  it('pays a full holiday at 150% and the eve from 16:00', () => {
    const holiday = dayOf('2026-09', '2026-09-21', [
      entry('2026-09-21', '08:00', '12:00'),
    ])
    expect(holiday.day.holidayName).toBe('יום כיפור')
    expect(holiday.day.minutes.holiday).toBe(240)
    expect(holiday.day.gross).toBe(360)

    const eve = dayOf('2026-09', '2026-09-20', [
      entry('2026-09-20', '15:00', '18:00'),
    ])
    expect(eve.day.eveName).toBe('ערב יום כיפור')
    expect(eve.day.minutes.regular).toBe(60)
    expect(eve.day.minutes.holiday).toBe(120)
    expect(eve.day.gross).toBe(240)
  })

  it('moves hours above 42 regular hours in the week to overtime', () => {
    const entries = [
      entry('2026-11-01', '08:00', '16:00'),
      entry('2026-11-02', '08:00', '16:00'),
      entry('2026-11-03', '08:00', '16:00'),
      entry('2026-11-04', '08:00', '16:00'),
      entry('2026-11-05', '08:00', '16:00'),
      entry('2026-11-06', '08:00', '15:00'),
    ]
    const result = buildMonthPay({
      month: '2026-11',
      basis: 'hourly',
      amount: 60,
      entries,
    })
    const friday = result.days.find((day) => day.date === '2026-11-06')
    expect(friday?.minutes.regular).toBe(120)
    expect(friday?.minutes.ot125).toBe(120)
    expect(friday?.minutes.ot150).toBe(180)
    expect(result.totals.regular).toBe(2520)
  })

  it('keeps a night shift that crosses into Shabbat on the right days', () => {
    const result = buildMonthPay({
      month: '2026-11',
      basis: 'hourly',
      amount: 60,
      entries: [entry('2026-11-06', '22:00', '06:00')],
    })
    const friday = result.days.find((day) => day.date === '2026-11-06')
    const saturday = result.days.find((day) => day.date === '2026-11-07')
    expect(friday?.minutes.shabbat).toBe(120)
    expect(saturday?.minutes.shabbat).toBe(360)
    expect(friday?.entries[0]).toEqual({
      id: '2026-11-06-22:00',
      originDate: '2026-11-06',
      from: '22:00',
      to: '00:00',
    })
    expect(saturday?.entries[0]).toEqual({
      id: '2026-11-06-22:00',
      originDate: '2026-11-06',
      from: '00:00',
      to: '06:00',
    })
  })

  it('converts a monthly salary with 182 hours', () => {
    const result = buildMonthPay({
      month: '2026-11',
      basis: 'monthly',
      amount: 18200,
      entries: [entry('2026-11-01', '08:00', '09:00')],
    })
    const day = result.days.find((item) => item.date === '2026-11-01')
    expect(result.hourlyRate).toBe(100)
    expect(day?.gross).toBe(100)
  })

  it('counts vacation hours like regular work time', () => {
    const { day } = dayOf('2026-11', '2026-11-02', [
      entry('2026-11-02', '08:00', '16:00', 'leave-1', 'vacation'),
    ])
    expect(day.minutes.regular).toBe(480)
    expect(day.gross).toBe(480)
  })
})
