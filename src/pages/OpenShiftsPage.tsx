import { useEffect, useMemo, useState } from 'react'
import { CheckSquare, Lock, Search, Square } from 'lucide-react'
import { ShiftSignOffDialog } from '../components/ShiftSignOffDialog'
import { EmptyState, Ltr, SectionCard } from '../components/ui'
import { SHIFT_TYPE_LABELS } from '../constants'
import { useApp } from '../context/AppContext'
import { formatShiftDate } from '../lib/hebrew'
import { notify } from '../lib/notify'
import {
  formatSignOffStamp,
  isShiftSignedOff,
} from '../lib/shiftSignOff'
import {
  formatShiftModelWindow,
  resolveShiftModels,
  shiftModelLabel,
} from '../lib/shiftModels'
import type { ShiftSchedule, ShiftType } from '../types'

type StatusFilter = 'open' | 'closed' | 'all'

function shiftTitle(
  shift: ShiftSchedule,
  models: ReturnType<typeof resolveShiftModels>,
): string {
  return (
    shiftModelLabel(models, shift.shiftType) ||
    SHIFT_TYPE_LABELS[shift.shiftType] ||
    shift.shiftType
  )
}

export function OpenShiftsPage() {
  const { data, module, user, syncing, signOffShifts, loadShiftFromHistory } =
    useApp()
  const [status, setStatus] = useState<StatusFilter>('open')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  const models = useMemo(
    () => resolveShiftModels(data.shiftModels, module),
    [data.shiftModels, module],
  )

  const sorted = useMemo(
    () =>
      [...data.history].sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
      ),
    [data.history],
  )

  const openCount = useMemo(
    () => sorted.filter((shift) => !isShiftSignedOff(shift)).length,
    [sorted],
  )
  const closedCount = sorted.length - openCount

  const rows = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('he')
    return sorted.filter((shift) => {
      const closed = isShiftSignedOff(shift)
      if (status === 'open' && closed) return false
      if (status === 'closed' && !closed) return false
      if (!text) return true
      const label = shiftTitle(shift, models).toLocaleLowerCase('he')
      const signer = (shift.signOff?.signerName || '').toLocaleLowerCase('he')
      return (
        shift.date.includes(text) ||
        label.includes(text) ||
        signer.includes(text) ||
        formatShiftDate(shift.date).includes(text)
      )
    })
  }, [sorted, status, query, models])

  const selectableIds = useMemo(
    () => rows.filter((shift) => !isShiftSignedOff(shift)).map((shift) => shift.id),
    [rows],
  )

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (selectableIds.includes(id)) next.add(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [selectableIds])

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const selectedCount = selected.size

  const toggleOne = (id: string, locked: boolean) => {
    if (locked) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(selectableIds))
  }

  const lockSelected = async (signature: string) => {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      const locked = await signOffShifts(ids, signature)
      setConfirmOpen(false)
      setSelected(new Set())
      if (locked === 0) {
        notify.info('אין משמרות פתוחות לנעילה')
        return
      }
      notify.success(
        locked === 1 ? 'משמרת אחת ננעלה' : `${locked} משמרות ננעלו`,
        'לא ניתן יותר לערוך או למחוק אותן.',
      )
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'נעילת המשמרות נכשלה')
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="משמרות פתוחות וסגורות"
        subtitle="סמנו משמרות פתוחות ונעלו אותן יחד — אחרי הנעילה הלוח לא ניתן לעריכה"
      >
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-xs text-ink-soft">פתוחות</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-warn">
              {openCount}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-xs text-ink-soft">סגורות</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ok">
              {closedCount}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-xs text-ink-soft">נבחרו</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">
              {selectedCount}
            </p>
          </div>
          <label className="rounded-xl border border-line bg-surface p-3">
            <span className="mb-1 block text-xs text-ink-soft">סינון</span>
            <select
              className="ui-field w-full !py-1.5 text-sm"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as StatusFilter)
              }
            >
              <option value="open">פתוחות בלבד</option>
              <option value="closed">סגורות בלבד</option>
              <option value="all">הכל</option>
            </select>
          </label>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
              aria-hidden
            />
            <input
              className="ui-field w-full !pr-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חיפוש לפי תאריך או משמרת…"
              aria-label="חיפוש משמרות"
            />
          </label>
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            onClick={toggleAll}
            disabled={selectableIds.length === 0}
          >
            {allSelected ? (
              <CheckSquare className="size-4" aria-hidden />
            ) : (
              <Square className="size-4" aria-hidden />
            )}
            {allSelected ? 'ביטול בחירה' : 'בחר הכל הפתוחות'}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={selectedCount === 0 || syncing}
            onClick={() => setConfirmOpen(true)}
          >
            <Lock className="size-4" aria-hidden />
            נעילת נבחרות ({selectedCount})
          </button>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={status === 'open' ? 'אין משמרות פתוחות' : 'אין משמרות להצגה'}
            text={
              query
                ? 'נסו לשנות את החיפוש או את הסינון.'
                : status === 'open'
                  ? 'כל המשמרות ששמורות כבר נסגרו וננעלו.'
                  : 'עדיין לא נשמרו שיבוצים במערכת.'
            }
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {rows.map((shift) => {
              const locked = isShiftSignedOff(shift)
              const checked = selected.has(shift.id)
              const model = models.find((item) => item.id === shift.shiftType)
              const windowLabel = model
                ? formatShiftModelWindow(model)
                : ''
              return (
                <li
                  key={shift.id}
                  className={`flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4 ${
                    locked ? 'bg-surface/40' : 'bg-card'
                  }`}
                >
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-line accent-[var(--brand)]"
                      checked={checked}
                      disabled={locked || syncing}
                      onChange={() => toggleOne(shift.id, locked)}
                      aria-label={
                        locked
                          ? `משמרת ${shiftTitle(shift, models)} סגורה`
                          : `בחירת משמרת ${shiftTitle(shift, models)}`
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-right"
                    onClick={() => loadShiftFromHistory(shift.id)}
                  >
                    <p className="font-semibold text-ink">
                      {shiftTitle(shift, models)}
                      <span className="mx-1.5 text-ink-soft">·</span>
                      <Ltr className="inline">{formatShiftDate(shift.date)}</Ltr>
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-soft">
                      {windowLabel || SHIFT_TYPE_LABELS[shift.shiftType as ShiftType]}
                      {locked && shift.signOff ? (
                        <>
                          {' '}
                          · ננעלה ע״י {shift.signOff.signerName}
                          {shift.signOff.signedAt ? (
                            <>
                              {' '}
                              ב־
                              <Ltr className="inline">
                                {formatSignOffStamp(shift.signOff.signedAt)}
                              </Ltr>
                            </>
                          ) : null}
                        </>
                      ) : (
                        ' · פתוחה לעריכה'
                      )}
                    </p>
                  </button>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                      locked
                        ? 'bg-ok-soft text-ok'
                        : 'bg-warn-soft text-warn'
                    }`}
                  >
                    {locked ? (
                      <>
                        <Lock className="size-3.5" aria-hidden />
                        סגורה
                      </>
                    ) : (
                      'פתוחה'
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {confirmOpen ? (
        <ShiftSignOffDialog
          accountName={user?.fullName || ''}
          busy={syncing}
          onClose={() => {
            if (!syncing) setConfirmOpen(false)
          }}
          onConfirm={(signature) => {
            void lockSelected(signature)
          }}
        />
      ) : null}
    </div>
  )
}
