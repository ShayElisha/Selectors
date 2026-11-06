import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import {
  addWorkerPayEntryRemote,
  deleteWorkerPayEntryRemote,
  fetchWorkerPayRemote,
  saveWorkerPayRateRemote,
  type WorkerPayState,
} from '../api'
import { PageLoader } from '../components/PageLoader'
import { FieldLabel, Ltr, SectionCard } from '../components/ui'
import {
  PAY_RULES,
  buildMonthPay,
  daysInMonth,
  formatHours,
  yearQueryRange,
  type PayBasis,
  type PayDay,
  type PayMinutes,
} from '../lib/grossPay'
import { notify } from '../lib/notify'
import { useWorkerPortalPaths } from '../lib/workerPortalPaths'

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const MONTH_NAMES = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
]

const moneyFormat = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function todayIso(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function monthTitle(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${MONTH_NAMES[monthNumber - 1] ?? month} ${year}`
}

function money(value: number | null): string {
  if (value == null) return '—'
  return moneyFormat.format(value)
}

function workedMinutes(minutes: PayMinutes): number {
  return (
    minutes.regular +
    minutes.ot125 +
    minutes.ot150 +
    minutes.shabbat +
    minutes.holiday
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface/70 px-3 py-2">
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className="mt-0.5 font-semibold text-ink">
        <Ltr>{value}</Ltr>
      </p>
    </div>
  )
}

function dayTag(day: PayDay): string | null {
  if (day.holidayName) return day.holidayName
  if (day.weekday === 6) return day.eveName ? `שבת · ${day.eveName}` : 'שבת'
  if (day.weekday === 5) {
    return day.eveName ? `${day.eveName} · שבת מ־16:00` : 'שישי · שבת מ־16:00'
  }
  if (day.eveName) return `${day.eveName} מ־16:00`
  return null
}

export function WorkerPayPage() {
  const { module, home } = useWorkerPortalPaths()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(currentMonth)
  const [pay, setPay] = useState<WorkerPayState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [basis, setBasis] = useState<PayBasis>('hourly')
  const [amount, setAmount] = useState('')
  const [savingRate, setSavingRate] = useState(false)
  const [entryDate, setEntryDate] = useState(todayIso)
  const [entryStart, setEntryStart] = useState('08:00')
  const [entryEnd, setEntryEnd] = useState('16:00')
  const [savingEntry, setSavingEntry] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loadedYear, setLoadedYear] = useState<number | null>(null)
  const requestId = useRef(0)

  const load = useCallback(async (target: number) => {
    const id = requestId.current + 1
    requestId.current = id
    setLoading(true)
    try {
      const range = yearQueryRange(target)
      const data = await fetchWorkerPayRemote(range.from, range.to)
      if (requestId.current !== id) return
      setPay(data)
      setLoadedYear(target)
      setBasis(data.basis === 'monthly' ? 'monthly' : 'hourly')
      setAmount(data.amount > 0 ? String(data.amount) : '')
      setError(null)
    } catch (err) {
      if (requestId.current !== id) return
      setError(err instanceof Error ? err.message : 'טעינת השכר נכשלה')
    } finally {
      if (requestId.current === id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (module !== 'inspectors') return
    void load(year)
  }, [load, module, year])

  useEffect(() => {
    const days = daysInMonth(month)
    const today = todayIso()
    setEntryDate(days.includes(today) ? today : (days[0] ?? today))
  }, [month])

  const months = useMemo(() => {
    const entries = loadedYear === year ? (pay?.entries ?? []) : []
    return MONTH_NAMES.map((_, index) =>
      buildMonthPay({
        month: `${year}-${String(index + 1).padStart(2, '0')}`,
        basis: pay?.basis ?? null,
        amount: pay?.amount ?? 0,
        entries,
      }),
    )
  }, [loadedYear, pay, year])

  const ready = loadedYear === year
  const report = months.find((item) => item.month === month) ?? months[0]
  const yearGross = !ready || report?.hourlyRate == null
    ? null
    : Math.round(
        months.reduce((sum, item) => sum + (item.gross ?? 0), 0) * 100,
      ) / 100

  if (module !== 'inspectors') return <Navigate to={home} replace />

  const saveRate = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = Math.round(Number(amount) * 100) / 100
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('הזינו סכום של 1 לפחות')
      return
    }
    setSavingRate(true)
    setError(null)
    const id = requestId.current + 1
    requestId.current = id
    try {
      const saved = await saveWorkerPayRateRemote({ basis, amount: parsed })
      if (requestId.current !== id) return
      setPay(saved)
      setLoadedYear(year)
      setAmount(String(saved.amount))
      notify.success('השכר נשמר')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירת השכר נכשלה')
    } finally {
      setSavingRate(false)
    }
  }

  const addEntry = async (event: FormEvent) => {
    event.preventDefault()
    setSavingEntry(true)
    setError(null)
    const id = requestId.current + 1
    requestId.current = id
    try {
      const created = await addWorkerPayEntryRemote({
        date: entryDate,
        start: entryStart.slice(0, 5),
        end: entryEnd.slice(0, 5),
      })
      if (requestId.current !== id) return
      setPay((current) =>
        current
          ? { ...current, entries: [...current.entries, created] }
          : { basis: null, amount: 0, entries: [created] },
      )
      notify.success('הרשומה נוספה')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירת הרשומה נכשלה')
    } finally {
      setSavingEntry(false)
    }
  }

  const removeEntry = async (id: string) => {
    setDeletingId(id)
    setError(null)
    const request = requestId.current + 1
    requestId.current = request
    try {
      await deleteWorkerPayEntryRemote(id)
      if (requestId.current !== request) return
      setPay((current) =>
        current
          ? {
              ...current,
              entries: current.entries.filter((entry) => entry.id !== id),
            }
          : current,
      )
      notify.success('הרשומה נמחקה')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'מחיקת הרשומה נכשלה')
    } finally {
      setDeletingId(null)
    }
  }

  const monthDays = daysInMonth(month)

  return (
    <div className="space-y-4">
      <SectionCard
        title="שכר לפי חודשים"
        subtitle={`${year} · כל חודש מה־1 עד סוף החודש`}
        actions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="ui-btn ui-btn-ghost !px-2.5"
              aria-label="שנה קודמת"
              onClick={() => {
                const next = year - 1
                setYear(next)
                setMonth(`${next}-${month.slice(5, 7)}`)
              }}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
            <span className="min-w-16 text-center text-sm font-semibold text-ink">
              <Ltr>{year}</Ltr>
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-ghost !px-2.5"
              aria-label="שנה הבאה"
              onClick={() => {
                const next = year + 1
                setYear(next)
                setMonth(`${next}-${month.slice(5, 7)}`)
              }}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
          </div>
        }
      >
        <p className="text-3xl font-bold text-ink">
          <Ltr>{money(yearGross)}</Ltr>
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {report.hourlyRate == null
            ? 'הגדירו שכר כדי לראות ברוטו. השעות נשמרות גם בלי סכום.'
            : pay?.basis === 'monthly'
              ? `ברוטו לשנה · שכר חודשי ${money(pay.amount)} · שעה ${money(report.hourlyRate)}`
              : `ברוטו לשנה · שכר שעתי ${money(report.hourlyRate)}`}
        </p>
        <details className="mt-4 text-sm leading-relaxed text-ink-soft">
          <summary className="cursor-pointer font-medium text-ink">
            איך מחושב הברוטו
          </summary>
          <p className="mt-2">{PAY_RULES}</p>
        </details>
      </SectionCard>

      <SectionCard title="השכר שלי" subtitle="הסכום נשמר אצלכם ומשמש לחישוב כל החודשים.">
        <form onSubmit={(event) => void saveRate(event)} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <FieldLabel htmlFor="pay-basis">סוג שכר</FieldLabel>
            <select
              id="pay-basis"
              className="ui-field"
              value={basis}
              onChange={(event) => setBasis(event.target.value as PayBasis)}
              disabled={savingRate}
            >
              <option value="hourly">שכר שעתי</option>
              <option value="monthly">שכר חודשי</option>
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="pay-amount">
              {basis === 'monthly' ? 'ברוטו לחודש (₪)' : 'ברוטו לשעה (₪)'}
            </FieldLabel>
            <input
              id="pay-amount"
              className="ui-field"
              dir="ltr"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={basis === 'monthly' ? '12000' : '60'}
              disabled={savingRate}
              required
            />
          </div>
          <button
            type="submit"
            className="ui-btn ui-btn-primary disabled:opacity-40"
            disabled={savingRate || !amount.trim()}
          >
            {savingRate ? 'שומר…' : 'שמירת שכר'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="רשומת שעות" subtitle="אם שעת הסיום מוקדמת מההתחלה, הרשומה נמשכת ליום הבא.">
        <form onSubmit={(event) => void addEntry(event)} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <FieldLabel htmlFor="pay-date">תאריך</FieldLabel>
            <select
              id="pay-date"
              className="ui-field"
              value={entryDate}
              onChange={(event) => setEntryDate(event.target.value)}
              disabled={savingEntry}
            >
              {monthDays.map((date) => (
                <option key={date} value={date}>
                  {Number(date.slice(8))} ב{MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ·{' '}
                  {DAY_NAMES[report.days.find((day) => day.date === date)?.weekday ?? 0]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="pay-start">התחלה</FieldLabel>
            <input
              id="pay-start"
              className="ui-field"
              dir="ltr"
              type="time"
              value={entryStart}
              onChange={(event) => setEntryStart(event.target.value)}
              required
              disabled={savingEntry}
            />
          </div>
          <div>
            <FieldLabel htmlFor="pay-end">סיום</FieldLabel>
            <input
              id="pay-end"
              className="ui-field"
              dir="ltr"
              type="time"
              value={entryEnd}
              onChange={(event) => setEntryEnd(event.target.value)}
              required
              disabled={savingEntry}
            />
          </div>
          <button
            type="submit"
            className="ui-btn ui-btn-primary disabled:opacity-40"
            disabled={savingEntry}
          >
            <Plus className="size-4" aria-hidden />
            {savingEntry ? 'שומר…' : 'הוספה'}
          </button>
        </form>
        {error ? (
          <p className="mt-3 text-sm font-medium text-hard" role="alert">
            {error}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard
        title="החודשים"
        subtitle="כל שנה מוצגת לפי חודשים. לחצו על חודש כדי לפתוח את הימים שלו."
      >
        {loading && loadedYear !== year ? (
          <PageLoader label="טוען שכר…" />
        ) : error && loadedYear !== year ? (
          <p className="text-sm font-medium text-hard" role="alert">
            {error}
          </p>
        ) : (
          <ol className="space-y-2">
            {months.map((item) => {
              const open = item.month === month
              const hours = workedMinutes(item.totals)
              const isCurrent = item.month === currentMonth()
              return (
                <li key={item.month}>
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-start ${
                      open
                        ? 'border-brand/40 bg-brand/5'
                        : 'border-line/80 bg-surface/30'
                    }`}
                    aria-expanded={open}
                    onClick={() => setMonth(item.month)}
                  >
                    <span className="min-w-0">
                      <span className="font-semibold text-ink">
                        {monthTitle(item.month)}
                      </span>
                      {isCurrent ? (
                        <span className="ms-2 text-xs font-semibold text-brand">
                          החודש
                        </span>
                      ) : null}
                    </span>
                    <span className="text-end">
                      <span className="block font-semibold text-ink">
                        <Ltr>{money(item.gross)}</Ltr>
                      </span>
                      <span className="block text-xs text-ink-soft">
                        <Ltr>{formatHours(hours)}</Ltr>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </SectionCard>

      {ready && report ? (
        <SectionCard
          title={monthTitle(report.month)}
          subtitle="מה־1 עד סוף החודש"
        >
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="רגיל 100%" value={formatHours(report.totals.regular)} />
            <Stat label="125%" value={formatHours(report.totals.ot125)} />
            <Stat label="150%" value={formatHours(report.totals.ot150)} />
            <Stat label="שבת" value={formatHours(report.totals.shabbat)} />
            <Stat label="חג" value={formatHours(report.totals.holiday)} />
          </div>
          <p className="mb-3 text-sm text-ink-soft">
            ברוטו לחודש <Ltr>{money(report.gross)}</Ltr>
          </p>
          <ol className="space-y-2">
            {report.days.map((day) => (
              <DayRow
                key={day.date}
                day={day}
                today={day.date === todayIso()}
                deletingId={deletingId}
                onDelete={(id) => void removeEntry(id)}
              />
            ))}
          </ol>
        </SectionCard>
      ) : null}
    </div>
  )
}

function DayRow({
  day,
  today,
  deletingId,
  onDelete,
}: {
  day: PayDay
  today: boolean
  deletingId: string | null
  onDelete: (id: string) => void
}) {
  const tag = dayTag(day)
  const worked =
    day.minutes.regular +
    day.minutes.ot125 +
    day.minutes.ot150 +
    day.minutes.shabbat +
    day.minutes.holiday
  return (
    <li
      className={`rounded-xl border px-3 py-2.5 ${
        today ? 'border-brand/40 bg-brand/5' : 'border-line/80 bg-surface/30'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            <Ltr>{Number(day.date.slice(8))}</Ltr>
            <span className="ms-2 font-medium text-ink-soft">
              יום {DAY_NAMES[day.weekday]}
            </span>
            {today ? (
              <span className="ms-2 text-xs font-semibold text-brand">היום</span>
            ) : null}
          </p>
          {tag ? <p className="text-xs text-ink-soft">{tag}</p> : null}
        </div>
        <div className="text-end">
          <p className="font-semibold text-ink">
            <Ltr>{money(day.gross)}</Ltr>
          </p>
          <p className="text-xs text-ink-soft">
            <Ltr>{formatHours(worked)}</Ltr>
          </p>
        </div>
      </div>
      {day.entries.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {day.entries.map((entry) => (
            <li
              key={`${entry.id}-${entry.from}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="text-ink">
                <Ltr>
                  {entry.from}–{entry.to}
                </Ltr>
                {entry.originDate !== day.date ? (
                  <span className="ms-2 text-xs text-ink-soft">המשך</span>
                ) : null}
              </span>
              {entry.originDate === day.date ? (
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost !px-2 !py-1 text-xs text-hard"
                  aria-label={`מחיקת רשומה ב-${day.date}`}
                  disabled={deletingId === entry.id}
                  onClick={() => onDelete(entry.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  מחיקה
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-ink-soft">אין רשומה</p>
      )}
      {worked > 0 ? (
        <p className="mt-1 text-[11px] text-ink-soft">
          <MinuteBits day={day} />
        </p>
      ) : null}
    </li>
  )
}

function MinuteBits({ day }: { day: PayDay }) {
  const parts = [
    day.minutes.regular ? `רגיל ${formatHours(day.minutes.regular)}` : '',
    day.minutes.ot125 ? `125% ${formatHours(day.minutes.ot125)}` : '',
    day.minutes.ot150 ? `150% ${formatHours(day.minutes.ot150)}` : '',
    day.minutes.shabbat ? `שבת ${formatHours(day.minutes.shabbat)}` : '',
    day.minutes.holiday ? `חג ${formatHours(day.minutes.holiday)}` : '',
  ].filter(Boolean)
  return <Ltr>{parts.join(' · ')}</Ltr>
}
