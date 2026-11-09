/** Gross-pay estimate for inspector hour records. */

const DAY = 24 * 60
const REST_CUT = 16 * 60
const DAILY_CAP = 504
const FRIDAY_CAP = 420
const OT_125 = 120
const WEEKLY_CAP = 42 * 60

export type PayBasis = 'hourly' | 'monthly'

export type WorkEntryKind = 'work' | 'vacation' | 'sick'

export interface WorkEntry {
  id: string
  date: string
  start: string
  end: string
  kind?: WorkEntryKind
  rateId?: string
}

export interface PayMinutes {
  regular: number
  ot125: number
  ot150: number
  shabbat: number
  holiday: number
}

export interface PayDayEntry {
  id: string
  from: string
  to: string
  originDate: string
}

export interface PayDay {
  date: string
  weekday: number
  holidayName: string | null
  eveName: string | null
  entries: PayDayEntry[]
  minutes: PayMinutes
  gross: number | null
}

export interface MonthPay {
  month: string
  hourlyRate: number | null
  days: PayDay[]
  totals: PayMinutes
  gross: number | null
}

const HEBREW_EPOCH = -1373427

function isGregorianLeap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function gregorianToFixed(year: number, month: number, day: number): number {
  const y = year - 1
  return (
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) +
    Math.floor((367 * month - 362) / 12) +
    (month <= 2 ? 0 : isGregorianLeap(year) ? -1 : -2) +
    day
  )
}

function hebrewLeap(year: number): boolean {
  return (7 * year + 1) % 19 < 7
}

function tishrei1(year: number): number {
  const months = Math.floor((235 * year - 234) / 19)
  const parts = 12084 + 13753 * months
  let day = months * 29 + Math.floor(parts / 25920)
  if ((3 * (day + 1)) % 7 < 3) day += 1
  return day + HEBREW_EPOCH
}

function monthLengths(year: number): number[] {
  const len = tishrei1(year + 1) - tishrei1(year)
  const heshvan = len % 10 === 5 ? 30 : 29
  const kislev = len % 10 === 3 ? 29 : 30
  const adar = hebrewLeap(year) ? [30, 29] : [29]
  return [30, heshvan, kislev, 29, 30, ...adar, 30, 29, 30, 29, 30, 29]
}

function hebrewToFixed(year: number, monthIndex: number, day: number): number {
  let fixed = tishrei1(year)
  const lengths = monthLengths(year)
  for (let i = 0; i < monthIndex; i += 1) fixed += lengths[i] ?? 0
  return fixed + day - 1
}

interface HolidayMark {
  fixed: number
  name: string
}

const holidayCache = new Map<number, HolidayMark[]>()

function holidaysOf(hebrewYear: number): HolidayMark[] {
  const cached = holidayCache.get(hebrewYear)
  if (cached) return cached
  const nisan = hebrewLeap(hebrewYear) ? 7 : 6
  const tishrei = tishrei1(hebrewYear)
  const marks: HolidayMark[] = [
    { fixed: tishrei, name: 'ראש השנה' },
    { fixed: tishrei + 1, name: 'ראש השנה' },
    { fixed: hebrewToFixed(hebrewYear, 0, 10), name: 'יום כיפור' },
    { fixed: hebrewToFixed(hebrewYear, 0, 15), name: 'סוכות' },
    { fixed: hebrewToFixed(hebrewYear, 0, 22), name: 'שמיני עצרת' },
    { fixed: hebrewToFixed(hebrewYear, nisan, 15), name: 'פסח' },
    { fixed: hebrewToFixed(hebrewYear, nisan, 21), name: 'שביעי של פסח' },
    { fixed: hebrewToFixed(hebrewYear, nisan + 2, 6), name: 'שבועות' },
  ]
  holidayCache.set(hebrewYear, marks)
  return marks
}

function fixedOfIso(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return gregorianToFixed(year, month, day)
}

export function holidayName(iso: string): string | null {
  const fixed = fixedOfIso(iso)
  if (fixed == null) return null
  const year = Number(iso.slice(0, 4))
  for (const hebrewYear of [year + 3760, year + 3761, year + 3762]) {
    const hit = holidaysOf(hebrewYear).find((item) => item.fixed === fixed)
    if (hit) return hit.name
  }
  return null
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function daysInMonth(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const last = new Date(year, monthNumber, 0).getDate()
  const pad = (value: number) => String(value).padStart(2, '0')
  const days: string[] = []
  for (let day = 1; day <= last; day += 1) {
    days.push(`${year}-${pad(monthNumber)}-${pad(day)}`)
  }
  return days
}

export function monthQueryRange(month: string): { from: string; to: string } {
  const days = daysInMonth(month)
  const first = days[0] ?? `${month}-01`
  const last = days[days.length - 1] ?? first
  return {
    from: addDays(first, -weekdayOf(first)),
    to: addDays(last, 6 - weekdayOf(last)),
  }
}

export function yearQueryRange(year: number): { from: string; to: string } {
  const start = monthQueryRange(`${year}-01`)
  const end = monthQueryRange(`${year}-12`)
  return { from: start.from, to: end.to }
}

function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

function formatClock(minute: number): string {
  const clock = minute % DAY
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(clock / 60))}:${pad(clock % 60)}`
}

type Bucket = 'weekday' | 'shabbat' | 'holiday'

function bucketAt(date: string, minute: number): Bucket {
  if (holidayName(date)) return 'holiday'
  const weekday = weekdayOf(date)
  if (weekday === 6) return 'shabbat'
  if (weekday === 5 && minute >= REST_CUT) return 'shabbat'
  if (minute >= REST_CUT && holidayName(addDays(date, 1))) return 'holiday'
  return 'weekday'
}

interface Piece {
  id: string
  originDate: string
  date: string
  startMin: number
  endMin: number
  bucket: Bucket
}

function splitEntry(entry: WorkEntry): Piece[] {
  const start = parseClock(entry.start)
  const endRaw = parseClock(entry.end)
  if (start == null || endRaw == null || endRaw === start) return []
  const end = endRaw < start ? endRaw + DAY : endRaw
  const pieces: Piece[] = []
  let cursor = start
  while (cursor < end) {
    const dayOffset = Math.floor(cursor / DAY)
    const minute = cursor % DAY
    const date = addDays(entry.date, dayOffset)
    let next = Math.min(end, (dayOffset + 1) * DAY)
    const cut = dayOffset * DAY + REST_CUT
    if (cursor < cut && cut < next) next = cut
    pieces.push({
      id: entry.id,
      originDate: entry.date,
      date,
      startMin: minute,
      endMin: minute + (next - cursor),
      bucket: bucketAt(date, minute),
    })
    cursor = next
  }
  return pieces
}

interface DayAcc extends PayMinutes {
  date: string
  spans: { id: string; originDate: string; startMin: number; endMin: number }[]
}

function emptyMinutes(): PayMinutes {
  return { regular: 0, ot125: 0, ot150: 0, shabbat: 0, holiday: 0 }
}

function applyDaily(date: string, weekdayMinutes: number): Pick<
  PayMinutes,
  'regular' | 'ot125' | 'ot150'
> {
  const cap = weekdayOf(date) === 5 ? FRIDAY_CAP : DAILY_CAP
  const regular = Math.min(weekdayMinutes, cap)
  const extra = weekdayMinutes - regular
  const ot125 = Math.min(extra, OT_125)
  return { regular, ot125, ot150: extra - ot125 }
}

function applyWeekly(days: DayAcc[]) {
  const byWeek = new Map<string, DayAcc[]>()
  for (const day of days) {
    const key = addDays(day.date, -weekdayOf(day.date))
    const list = byWeek.get(key) ?? []
    list.push(day)
    byWeek.set(key, list)
  }
  for (const list of byWeek.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date))
    let overflow = list.reduce((sum, day) => sum + day.regular, 0) - WEEKLY_CAP
    if (overflow <= 0) continue
    let budget = OT_125
    for (let index = list.length - 1; index >= 0 && overflow > 0; index -= 1) {
      const day = list[index]
      if (!day) continue
      const take = Math.min(day.regular, overflow)
      day.regular -= take
      const to125 = Math.min(take, budget)
      day.ot125 += to125
      day.ot150 += take - to125
      budget -= to125
      overflow -= take
    }
  }
}

export function hourlyRateOf(
  basis: PayBasis | null,
  amount: number,
): number | null {
  if (basis !== 'hourly' && basis !== 'monthly') return null
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (basis === 'hourly') return amount
  return amount / 182
}

function grossAmount(minutes: PayMinutes, rate: number): number {
  const value =
    (minutes.regular / 60) * rate +
    (minutes.ot125 / 60) * rate * 1.25 +
    (minutes.ot150 / 60) * rate * 1.5 +
    (minutes.shabbat / 60) * rate * 1.5 +
    (minutes.holiday / 60) * rate * 1.5
  return Math.round(value * 100) / 100
}

export function buildMonthPay(input: {
  month: string
  basis: PayBasis | null
  amount: number
  entries: WorkEntry[]
}): MonthPay {
  const pieces = input.entries.flatMap(splitEntry)
  const acc = new Map<string, DayAcc>()
  const ensure = (date: string) => {
    let day = acc.get(date)
    if (!day) {
      day = { date, ...emptyMinutes(), spans: [] }
      acc.set(date, day)
    }
    return day
  }
  const weekdayPool = new Map<string, number>()
  // Premium buckets follow the clock, but the whole shift is attributed to the
  // start date so overnight work (e.g. 21:00–06:30) stays on that day.
  for (const piece of pieces) {
    const day = ensure(piece.originDate)
    if (piece.bucket === 'shabbat') day.shabbat += piece.endMin - piece.startMin
    else if (piece.bucket === 'holiday') day.holiday += piece.endMin - piece.startMin
    else {
      weekdayPool.set(
        piece.originDate,
        (weekdayPool.get(piece.originDate) ?? 0) +
          (piece.endMin - piece.startMin),
      )
    }
  }
  for (const entry of input.entries) {
    const start = parseClock(entry.start)
    const endRaw = parseClock(entry.end)
    if (start == null || endRaw == null || endRaw === start) continue
    const day = ensure(entry.date)
    day.spans.push({
      id: entry.id,
      originDate: entry.date,
      startMin: start,
      endMin: endRaw < start ? endRaw + DAY : endRaw,
    })
  }
  for (const [date, minutes] of weekdayPool) {
    const tiers = applyDaily(date, minutes)
    const day = ensure(date)
    day.regular += tiers.regular
    day.ot125 += tiers.ot125
    day.ot150 += tiers.ot150
  }
  applyWeekly([...acc.values()])

  const rate = hourlyRateOf(input.basis, input.amount)
  const days = daysInMonth(input.month).map((date) => {
    const source = acc.get(date)
    const minutes = source
      ? {
          regular: source.regular,
          ot125: source.ot125,
          ot150: source.ot150,
          shabbat: source.shabbat,
          holiday: source.holiday,
        }
      : emptyMinutes()
    const spans = new Map<
      string,
      { id: string; originDate: string; startMin: number; endMin: number }
    >()
    for (const span of source?.spans ?? []) {
      const current = spans.get(span.id)
      if (!current) spans.set(span.id, { ...span })
      else {
        current.startMin = Math.min(current.startMin, span.startMin)
        current.endMin = Math.max(current.endMin, span.endMin)
      }
    }
    const name = holidayName(date)
    const nextName = holidayName(addDays(date, 1))
    return {
      date,
      weekday: weekdayOf(date),
      holidayName: name,
      eveName: name || !nextName ? null : `ערב ${nextName}`,
      entries: [...spans.values()]
        .sort((a, b) => a.startMin - b.startMin)
        .map((span) => ({
          id: span.id,
          originDate: span.originDate,
          from: formatClock(span.startMin),
          to: formatClock(span.endMin),
        })),
      minutes,
      gross: rate == null ? null : grossAmount(minutes, rate),
    }
  })
  const totals = days.reduce<PayMinutes>((sum, day) => {
    sum.regular += day.minutes.regular
    sum.ot125 += day.minutes.ot125
    sum.ot150 += day.minutes.ot150
    sum.shabbat += day.minutes.shabbat
    sum.holiday += day.minutes.holiday
    return sum
  }, emptyMinutes())
  const gross =
    rate == null
      ? null
      : Math.round(days.reduce((sum, day) => sum + (day.gross ?? 0), 0) * 100) /
        100
  return { month: input.month, hourlyRate: rate, days, totals, gross }
}

export function formatHours(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(minutes)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`
}

export const PAY_RULES =
  'אומדן ברוטו לפי חוק שעות עבודה ומנוחה, לא תלוש שכר. משמרת שחוצה חצות משויכת ליום שבו התחילה; תוספות שבת/חג עדיין לפי השעון בפועל. ביום רגיל 8:24 הראשונות ב־100%, שעתיים שאחריהן ב־125%, והיתר ב־150%. ביום שישי עד 16:00 נספרות 7 שעות רגילות, ומ־16:00 עד סוף שבת השעות ב־150%. חג מלא וערב חג מ־16:00 גם ב־150%. מעל 42 שעות רגילות בשבוע (מראשון) העודף עובר לשעות נוספות. שכר חודשי מתורגם לשעתי לפי 182 שעות. החגים: שני ימי ראש השנה, יום כיפור, סוכות, שמיני עצרת, פסח, שביעי של פסח ושבועות.'
