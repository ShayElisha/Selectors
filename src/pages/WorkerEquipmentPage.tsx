import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Package, RefreshCw, Send } from 'lucide-react'
import {
  fetchWorkerEquipmentRequestsRemote,
  submitWorkerEquipmentRequestRemote,
  type EquipmentRequestItem,
  type EquipmentType,
} from '../api'
import { PageLoader } from '../components/PageLoader'
import { FieldLabel, SectionCard } from '../components/ui'
import { notify } from '../lib/notify'
import { useWorkerPortalPaths } from '../lib/workerPortalPaths'

const STATUS_LABELS: Record<string, string> = {
  pending: 'ממתין למנהל',
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

export function WorkerEquipmentPage() {
  const { portalTitle } = useWorkerPortalPaths()
  const [requests, setRequests] = useState<EquipmentRequestItem[]>([])
  const [types, setTypes] = useState<Record<string, string>>({
    vest: 'אפוד',
    device: 'מכשיר',
    key: 'מפתח',
    other: 'אחר',
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [equipmentType, setEquipmentType] = useState<EquipmentType>('vest')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await fetchWorkerEquipmentRequestsRemote()
      setRequests(data.requests)
      if (data.types) setTypes(data.types)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת בקשות הציוד נכשלה')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const created = await submitWorkerEquipmentRequestRemote({
        equipmentType,
        quantity: Number(quantity) || 1,
        notes,
      })
      setRequests((prev) => [created, ...prev])
      setNotes('')
      setQuantity('1')
      setEquipmentType('vest')
      notify.success('בקשת הציוד נשלחה למנהלים')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'שליחת בקשת הציוד נכשלה'
      setError(message)
      notify.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && requests.length === 0) {
    return <PageLoader centered size="sm" label="טוען בקשות ציוד…" />
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="בקשת ציוד"
        subtitle={`${portalTitle} · אפוד, מכשיר, מפתח או פריט אחר. הבקשה תופיע אצל המנהלים.`}
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
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <div>
            <FieldLabel htmlFor="eq-type">סוג ציוד</FieldLabel>
            <select
              id="eq-type"
              className="ui-field w-full"
              value={equipmentType}
              onChange={(e) =>
                setEquipmentType(e.target.value as EquipmentType)
              }
              disabled={submitting}
            >
              {Object.entries(types).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="eq-qty">כמות</FieldLabel>
            <input
              id="eq-qty"
              className="ui-field w-full"
              type="number"
              min={1}
              max={20}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div>
            <FieldLabel htmlFor="eq-notes">
              הערות{equipmentType === 'other' ? ' *' : ''}
            </FieldLabel>
            <textarea
              id="eq-notes"
              className="ui-field min-h-20 w-full resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                equipmentType === 'other'
                  ? 'פרטו איזה ציוד נדרש'
                  : 'מידה, דגם, או סיבה (אופציונלי)'
              }
              disabled={submitting}
            />
          </div>
          {error ? (
            <p className="text-sm font-medium text-hard" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="ui-btn ui-btn-primary disabled:opacity-40"
            disabled={submitting}
          >
            <Send className="size-4" aria-hidden />
            {submitting ? 'שולח…' : 'שליחת בקשה'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="הבקשות שלי" subtitle="סטטוס עדכני אחרי טיפול מנהל">
        {requests.length === 0 ? (
          <p className="rounded-xl bg-surface px-3 py-4 text-sm text-ink-soft">
            עדיין לא נשלחו בקשות ציוד.
          </p>
        ) : (
          <ul className="space-y-2">
            {requests.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-line/80 bg-surface/50 px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Package className="size-4 text-brand" aria-hidden />
                  <span className="font-semibold text-ink">
                    {item.equipmentLabel} ×{item.quantity}
                  </span>
                  <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-line">
                    {STATUS_LABELS[item.status] || item.status}
                  </span>
                </div>
                {item.notes ? (
                  <p className="mt-1 text-sm text-ink-soft">{item.notes}</p>
                ) : null}
                {item.managerNotes ? (
                  <p className="mt-1 text-sm text-brand">
                    תשובת מנהל: {item.managerNotes}
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] text-ink-soft">
                  {formatDate(item.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
