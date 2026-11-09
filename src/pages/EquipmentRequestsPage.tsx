import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Package, RefreshCw, X } from 'lucide-react'
import {
  fetchManagerEquipmentRequestsRemote,
  updateManagerEquipmentRequestRemote,
  type EquipmentRequestItem,
  type EquipmentStatus,
} from '../api'
import { PageLoader } from '../components/PageLoader'
import { EmptyState, SectionCard } from '../components/ui'
import { notify } from '../lib/notify'

const STATUS_LABELS: Record<string, string> = {
  pending: 'ממתין',
  approved: 'אושר',
  fulfilled: 'סופק',
  rejected: 'נדחה',
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
}

export function EquipmentRequestsPage() {
  const [requests, setRequests] = useState<EquipmentRequestItem[]>([])
  const [pending, setPending] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | EquipmentStatus>(
    'all',
  )
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      else setLoading(true)
      try {
        const data = await fetchManagerEquipmentRequestsRemote(
          statusFilter === 'all' ? undefined : statusFilter,
        )
        setRequests(data.requests)
        setPending(data.pending)
      } catch (err) {
        notify.error(
          err instanceof Error ? err.message : 'טעינת בקשות הציוד נכשלה',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [statusFilter],
  )

  useEffect(() => {
    void load()
  }, [load])

  const openCount = useMemo(
    () => requests.filter((item) => item.status === 'pending').length,
    [requests],
  )

  const update = async (
    item: EquipmentRequestItem,
    status: EquipmentStatus,
  ) => {
    let managerNotes = item.managerNotes || ''
    if (status === 'rejected') {
      const reason = window.prompt('הערה לעובד (אופציונלי):', managerNotes)
      if (reason === null) return
      managerNotes = reason.trim()
    } else if (status === 'fulfilled' || status === 'approved') {
      const note = window.prompt('הערה לעובד (אופציונלי):', managerNotes)
      if (note === null) return
      managerNotes = note.trim()
    }
    setBusyId(item.id)
    try {
      const updated = await updateManagerEquipmentRequestRemote(item.id, {
        status,
        managerNotes,
      })
      setRequests((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row)),
      )
      setPending((count) =>
        item.status === 'pending' && status !== 'pending'
          ? Math.max(0, count - 1)
          : count,
      )
      notify.success(`הבקשה עודכנה ל«${STATUS_LABELS[status]}»`)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'עדכון הבקשה נכשל')
    } finally {
      setBusyId(null)
    }
  }

  if (loading && requests.length === 0) {
    return <PageLoader centered size="sm" label="טוען בקשות ציוד…" />
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="בקשות ציוד"
        subtitle="בקשות מאפודים, מכשירים ומפתחות שנשלחו מפורטל העובדים"
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2.5"
            onClick={() => void load(true)}
            disabled={refreshing}
            aria-label="רענון"
          >
            <RefreshCw
              className={`size-4 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden
            />
          </button>
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-xs text-ink-soft">ממתינות</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-warn">
              {statusFilter === 'all' ? pending : openCount}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-xs text-ink-soft">מוצגות כרגע</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">
              {requests.length}
            </p>
          </div>
          <label className="rounded-xl border border-line bg-surface p-3 sm:col-span-1">
            <span className="mb-1 block text-xs text-ink-soft">סינון סטטוס</span>
            <select
              className="ui-field w-full !py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | EquipmentStatus)
              }
            >
              <option value="all">הכל</option>
              <option value="pending">ממתין</option>
              <option value="approved">אושר</option>
              <option value="fulfilled">סופק</option>
              <option value="rejected">נדחה</option>
            </select>
          </label>
        </div>

        {requests.length === 0 ? (
          <EmptyState
            title="אין בקשות ציוד"
            text="כשעובד ישלח בקשה לאפוד, מכשיר או מפתח — היא תופיע כאן."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[44rem] border-collapse text-start text-[13px]">
              <thead>
                <tr className="border-b border-line bg-brand/[0.045]">
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                    עובד
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                    ציוד
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                    הערות
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                    סטטוס
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                    נשלח
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                    פעולות
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item, index) => (
                  <tr
                    key={item.id}
                    className={`border-b border-line/50 last:border-b-0 ${
                      index % 2 === 1 ? 'bg-surface/50' : 'bg-card'
                    }`}
                  >
                    <td className="px-3 py-2.5 align-middle font-semibold text-ink">
                      {item.workerName || '—'}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className="inline-flex items-center gap-1.5">
                        <Package className="size-3.5 text-brand" aria-hidden />
                        {item.equipmentLabel} ×{item.quantity}
                      </span>
                    </td>
                    <td className="max-w-[14rem] px-3 py-2.5 align-middle text-ink-soft">
                      <p className="line-clamp-2">{item.notes || '—'}</p>
                      {item.managerNotes ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-brand">
                          מנהל: {item.managerNotes}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-line">
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-middle text-[12px] text-ink-soft whitespace-nowrap">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex flex-wrap gap-1">
                        {item.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              className="ui-btn ui-btn-secondary !py-1 text-xs"
                              disabled={busyId === item.id}
                              onClick={() => void update(item, 'approved')}
                            >
                              <Check className="size-3.5" aria-hidden />
                              אישור
                            </button>
                            <button
                              type="button"
                              className="ui-btn ui-btn-ghost !py-1 text-xs text-hard"
                              disabled={busyId === item.id}
                              onClick={() => void update(item, 'rejected')}
                            >
                              <X className="size-3.5" aria-hidden />
                              דחייה
                            </button>
                          </>
                        ) : null}
                        {item.status === 'approved' ? (
                          <button
                            type="button"
                            className="ui-btn ui-btn-primary !py-1 text-xs"
                            disabled={busyId === item.id}
                            onClick={() => void update(item, 'fulfilled')}
                          >
                            סומן כסופק
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
