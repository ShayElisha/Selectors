import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ImagePlus, RefreshCw, Send, X } from 'lucide-react'
import {
  fetchWorkerIncidentsRemote,
  submitWorkerFaultRemote,
  type WorkerIncidentItem,
} from '../api'
import { PageLoader } from '../components/PageLoader'
import { FieldLabel, SectionCard } from '../components/ui'
import { readFaultPhoto } from '../lib/avatarImage'
import { notify } from '../lib/notify'
import { useWorkerPortalPaths } from '../lib/workerPortalPaths'

const SEVERITIES: { id: WorkerIncidentItem['severity']; label: string }[] = [
  { id: 'low', label: 'נמוכה' },
  { id: 'medium', label: 'בינונית' },
  { id: 'high', label: 'גבוהה' },
  { id: 'critical', label: 'קריטית' },
]

const STATUS_LABELS: Record<WorkerIncidentItem['status'], string> = {
  pending_approval: 'ממתין לאישור מנהל',
  rejected: 'נדחה',
  open: 'פתוח',
  in_progress: 'בטיפול',
  resolved: 'טופל',
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
}

export function WorkerFaultsPage() {
  const { portalTitle } = useWorkerPortalPaths()
  const [incidents, setIncidents] = useState<WorkerIncidentItem[]>([])
  const [lanes, setLanes] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] =
    useState<WorkerIncidentItem['severity']>('medium')
  const [laneId, setLaneId] = useState('')
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await fetchWorkerIncidentsRemote()
      setIncidents(data.incidents)
      setLanes(data.lanes)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת דיווחי התקלות נכשלה')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await submitWorkerFaultRemote({
        title,
        description,
        severity,
        ...(laneId ? { laneId } : {}),
        ...(photoDataUrl ? { photoDataUrl } : {}),
      })
      setIncidents((prev) => [created, ...prev])
      setTitle('')
      setDescription('')
      setSeverity('medium')
      setLaneId('')
      setPhotoDataUrl(null)
      notify.success('הדיווח נשלח וממתין לאישור מנהל משמרת')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'שליחת דיווח התקלה נכשלה'
      setError(message)
      notify.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && incidents.length === 0) {
    return <PageLoader centered size="sm" label="טוען דיווחי תקלות…" />
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="דיווח תקלה"
        subtitle={`דיווח מתוך ${portalTitle}. התקלה תיפתח ביומן המחלקה רק אחרי אישור מנהל משמרת.`}
        actions={
          <button
            type="button"
            className="ui-btn ui-btn-ghost !px-2.5"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            aria-label="רענון"
          >
            <RefreshCw
              className={`size-4 ${loading || refreshing ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div>
            <FieldLabel htmlFor="fault-title">כותרת *</FieldLabel>
            <input
              id="fault-title"
              className="ui-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
              disabled={submitting}
              placeholder="למשל: תקלה בשער צפוני"
            />
          </div>
          <div>
            <FieldLabel htmlFor="fault-details">מה קרה *</FieldLabel>
            <textarea
              id="fault-details"
              className="ui-field min-h-28 resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              required
              disabled={submitting}
              placeholder="תארו את התקלה, מתי התחילה, ומה הושפע"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="fault-severity">חומרה</FieldLabel>
              <select
                id="fault-severity"
                className="ui-field"
                value={severity}
                onChange={(e) =>
                  setSeverity(e.target.value as WorkerIncidentItem['severity'])
                }
                disabled={submitting}
              >
                {SEVERITIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="fault-lane">עמדה קשורה</FieldLabel>
              <select
                id="fault-lane"
                className="ui-field"
                value={laneId}
                onChange={(e) => setLaneId(e.target.value)}
                disabled={submitting}
              >
                <option value="">ללא עמדה מסוימת</option>
                {lanes.map((lane) => (
                  <option key={lane.id} value={lane.id}>
                    {lane.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="fault-photo">תמונה (אופציונלי)</FieldLabel>
            <input
              ref={photoInputRef}
              id="fault-photo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={submitting || photoBusy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setPhotoBusy(true)
                void readFaultPhoto(file)
                  .then((data) => {
                    setPhotoDataUrl(data)
                    setError(null)
                  })
                  .catch((err) => {
                    const message =
                      err instanceof Error ? err.message : 'טעינת התמונה נכשלה'
                    setError(message)
                    notify.error(message)
                  })
                  .finally(() => setPhotoBusy(false))
              }}
            />
            {photoDataUrl ? (
              <div className="flex items-start gap-3">
                <a
                  href={photoDataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                >
                  <img
                    src={photoDataUrl}
                    alt="תצוגה מקדימה של תמונת התקלה"
                    className="size-24 rounded-xl border border-line/80 object-cover"
                  />
                </a>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm text-ink-soft">התמונה תצורף לדיווח</p>
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary !py-1.5 text-xs"
                    disabled={submitting}
                    onClick={() => setPhotoDataUrl(null)}
                  >
                    <X className="size-3.5" aria-hidden />
                    הסרת תמונה
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="ui-btn ui-btn-secondary w-full sm:w-auto"
                disabled={submitting || photoBusy}
                onClick={() => photoInputRef.current?.click()}
              >
                <ImagePlus className="size-4" aria-hidden />
                {photoBusy ? 'מעבד תמונה…' : 'צירוף תמונה'}
              </button>
            )}
          </div>
          {error ? (
            <p className="text-sm font-medium text-hard" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="ui-btn ui-btn-primary disabled:opacity-40"
            disabled={submitting || !title.trim() || !description.trim()}
          >
            <Send className="size-4" aria-hidden />
            {submitting ? 'שולח…' : 'שליחה לאישור מנהל'}
          </button>
        </form>
      </SectionCard>

      <SectionCard
        title="הדיווחים שלי"
        subtitle={
          incidents.length
            ? `${incidents.length} דיווחים`
            : 'עדיין לא שלחתם דיווח תקלה'
        }
      >
        {incidents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line/80 bg-surface/30 px-4 py-8 text-center">
            <AlertTriangle
              className="mx-auto size-8 text-ink-soft/50"
              aria-hidden
            />
            <p className="mt-3 text-sm font-semibold text-ink">אין דיווחים עדיין</p>
            <p className="mt-1 text-[13px] text-ink-soft">
              כשתשלחו תקלה, תוכלו לעקוב כאן אחרי סטטוס האישור והטיפול.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {incidents.map((item) => {
              const lane = lanes.find((candidate) => candidate.id === item.laneId)
              return (
                <li
                  key={item.id}
                  className="rounded-xl border border-line/70 bg-surface/40 p-3.5"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-line">
                      {STATUS_LABELS[item.status]}
                    </span>
                    <span className="text-xs text-ink-soft">
                      {SEVERITIES.find((entry) => entry.id === item.severity)?.label}
                    </span>
                    {lane ? (
                      <span className="text-xs text-ink-soft">{lane.name}</span>
                    ) : null}
                  </div>
                  <p className="font-semibold text-ink">{item.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                    {item.description}
                  </p>
                  {item.photoDataUrl ? (
                    <a
                      href={item.photoDataUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block"
                    >
                      <img
                        src={item.photoDataUrl}
                        alt="תמונה מצורפת"
                        className="max-h-36 rounded-lg border border-line/80 object-cover"
                      />
                    </a>
                  ) : null}
                  {item.status === 'rejected' && item.rejectionReason ? (
                    <p className="mt-2 text-sm text-hard">
                      סיבת הדחייה: {item.rejectionReason}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[11px] text-ink-soft">
                    נשלח {formatDate(item.createdAt)}
                    {item.approvedAt
                      ? ` · אושר ${formatDate(item.approvedAt)}`
                      : null}
                    {item.rejectedAt
                      ? ` · נדחה ${formatDate(item.rejectedAt)}`
                      : null}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
