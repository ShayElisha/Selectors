import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Download,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { SHIFT_TYPE_LABELS } from '../constants'
import { useApp } from '../context/AppContext'
import { downloadIncidentsCsv } from '../lib/incidentsExport'
import type {
  IncidentKind,
  IncidentRecord,
  IncidentSeverity,
  IncidentStatus,
  ShiftType,
} from '../types'
import { EmptyState, FieldLabel, SectionCard } from '../components/ui'

const SEVERITIES: { id: IncidentSeverity; label: string; color: string }[] = [
  { id: 'critical', label: 'קריטית', color: 'bg-hard-soft text-hard' },
  { id: 'high', label: 'גבוהה', color: 'bg-warn-soft text-warn' },
  { id: 'medium', label: 'בינונית', color: 'bg-accent-soft text-accent' },
  { id: 'low', label: 'נמוכה', color: 'bg-surface text-ink-soft' },
]

const STATUSES: { id: IncidentStatus; label: string }[] = [
  { id: 'pending_approval', label: 'ממתין לאישור' },
  { id: 'open', label: 'פתוח' },
  { id: 'in_progress', label: 'בטיפול' },
  { id: 'resolved', label: 'טופל' },
  { id: 'rejected', label: 'נדחה' },
]

const EDITOR_STATUSES: { id: IncidentStatus; label: string }[] = [
  { id: 'open', label: 'פתוח' },
  { id: 'in_progress', label: 'בטיפול' },
  { id: 'resolved', label: 'טופל' },
]

const SHIFT_TYPES: ShiftType[] = [
  'morning',
  'afternoonA',
  'afternoonB',
  'afternoon',
  'night',
]

type IncidentDraft = Pick<
  IncidentRecord,
  'kind' | 'title' | 'description' | 'severity' | 'status'
> & {
  laneId: string
  shiftDate: string
  shiftType: ShiftType | ''
  handlingNotes: string
}

const EMPTY_DRAFT: IncidentDraft = {
  kind: 'event',
  title: '',
  description: '',
  severity: 'medium',
  status: 'open',
  laneId: '',
  shiftDate: '',
  shiftType: '',
  handlingNotes: '',
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
}

function statusLabel(status: IncidentStatus): string {
  return STATUSES.find((item) => item.id === status)?.label ?? status
}

export function IncidentsPage() {
  const { data, upsertIncident, reviewWorkerFault, deleteIncident } = useApp()
  const incidents = data.incidents ?? []
  const [activeKind, setActiveKind] = useState<IncidentKind>('event')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | IncidentStatus>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | IncidentSeverity>(
    'all',
  )
  const [editor, setEditor] = useState<IncidentDraft | null>(null)
  const [editingId, setEditingId] = useState<string | undefined>()

  const pendingApprovals = useMemo(
    () =>
      incidents
        .filter(
          (item) => item.kind === 'fault' && item.status === 'pending_approval',
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [incidents],
  )

  const matchesSearch = useCallback(
    (item: IncidentRecord) => {
      const text =
        `${item.title} ${item.description} ${item.handlingNotes ?? ''} ${item.createdBy} ${item.reportedByName ?? ''} ${item.laneId ?? ''}`.toLocaleLowerCase(
          'he',
        )
      const laneName = item.laneId
        ? (data.lanes.find((lane) => lane.id === item.laneId)?.name ?? '')
        : ''
      return `${text} ${laneName}`.includes(
        query.trim().toLocaleLowerCase('he'),
      )
    },
    [data.lanes, query],
  )

  const visible = useMemo(
    () =>
      incidents
        .filter((item) => item.kind === activeKind)
        .filter((item) =>
          activeKind === 'fault' ? item.status !== 'pending_approval' : true,
        )
        .filter((item) =>
          activeKind === 'fault' ? item.status !== 'resolved' : true,
        )
        .filter((item) => statusFilter === 'all' || item.status === statusFilter)
        .filter(
          (item) => severityFilter === 'all' || item.severity === severityFilter,
        )
        .filter(matchesSearch)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [
      incidents,
      activeKind,
      statusFilter,
      severityFilter,
      matchesSearch,
    ],
  )

  /** Closed faults live in their own table + export (not mixed into the open journal). */
  const resolvedFaults = useMemo(
    () =>
      activeKind !== 'fault'
        ? []
        : incidents
            .filter((item) => item.kind === 'fault' && item.status === 'resolved')
            .filter(
              (item) =>
                severityFilter === 'all' || item.severity === severityFilter,
            )
            .filter(matchesSearch)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [incidents, activeKind, severityFilter, matchesSearch],
  )

  const showResolvedFaults =
    activeKind === 'fault' &&
    (statusFilter === 'all' || statusFilter === 'resolved')

  const openEditor = (item?: IncidentRecord) => {
    setEditingId(item?.id)
    setEditor(
      item
        ? {
            kind: item.kind ?? 'event',
            title: item.title,
            description: item.description,
            severity: item.severity,
            status:
              item.status === 'pending_approval' || item.status === 'rejected'
                ? 'open'
                : item.status,
            laneId: item.laneId ?? '',
            shiftDate: item.shiftDate ?? '',
            shiftType: item.shiftType ?? '',
            handlingNotes: item.handlingNotes ?? '',
          }
        : { ...EMPTY_DRAFT, kind: activeKind },
    )
  }

  const save = () => {
    if (!editor?.title.trim() || !editor.description.trim()) return
    upsertIncident({
      id: editingId,
      kind: editor.kind,
      title: editor.title,
      description: editor.description,
      severity: editor.severity,
      status: editor.status,
      handlingNotes: editor.handlingNotes,
      ...(editor.laneId ? { laneId: editor.laneId } : {}),
      ...(editor.shiftDate ? { shiftDate: editor.shiftDate } : {}),
      ...(editor.shiftType ? { shiftType: editor.shiftType } : {}),
    })
    setEditor(null)
    setEditingId(undefined)
  }

  const kindIncidents = incidents.filter((item) => item.kind === activeKind)
  const openCount = kindIncidents.filter((item) => item.status === 'open').length
  const workingCount = kindIncidents.filter(
    (item) => item.status === 'in_progress',
  ).length
  const criticalCount = kindIncidents.filter(
    (item) =>
      item.severity === 'critical' &&
      item.status !== 'resolved' &&
      item.status !== 'rejected' &&
      item.status !== 'pending_approval',
  ).length
  const kindLabel = activeKind === 'fault' ? 'תקלה' : 'אירוע'

  return (
    <div className="space-y-4">
      <SectionCard
        title="יומן אירועים ותקלות"
        subtitle="תיעוד אירועים תפעוליים, תקלות ציוד והטיפול בהם לאורך זמן. דיווחי עובדים נפתחים רק אחרי אישור מנהל."
        actions={
          <>
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() =>
                downloadIncidentsCsv(visible, data.lanes, {
                  filenamePrefix:
                    activeKind === 'fault'
                      ? 'faults-open'
                      : 'events-log',
                })
              }
              disabled={!visible.length}
            >
              <Download className="size-4" aria-hidden /> ייצוא{' '}
              {activeKind === 'fault' ? 'פתוחות' : ''} ({visible.length})
            </button>
            {activeKind === 'fault' ? (
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={() =>
                  downloadIncidentsCsv(resolvedFaults, data.lanes, {
                    filenamePrefix: 'faults-resolved',
                  })
                }
                disabled={!resolvedFaults.length}
              >
                <Download className="size-4" aria-hidden /> ייצוא שטופלו (
                {resolvedFaults.length})
              </button>
            ) : null}
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={() => openEditor()}
            >
              <Plus className="size-4" aria-hidden /> דיווח {kindLabel}
            </button>
          </>
        }
      >
        <div
          className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1"
          role="tablist"
          aria-label="סוג היומן"
        >
          {(
            [
              { id: 'event' as const, label: 'יומן אירועים', icon: ClipboardList },
              { id: 'fault' as const, label: 'יומן תקלות', icon: AlertTriangle },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon
            const count = incidents.filter((item) => item.kind === tab.id).length
            const pending =
              tab.id === 'fault'
                ? incidents.filter(
                    (item) =>
                      item.kind === 'fault' && item.status === 'pending_approval',
                  ).length
                : 0
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeKind === tab.id}
                onClick={() => setActiveKind(tab.id)}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${activeKind === tab.id ? 'bg-card text-ink shadow-sm ring-1 ring-line' : 'text-ink-soft hover:text-ink'}`}
              >
                <Icon className="size-4" aria-hidden />
                {tab.label}
                <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] tabular-nums">
                  {count}
                </span>
                {pending > 0 ? (
                  <span className="rounded-full bg-warn-soft px-1.5 py-0.5 text-[11px] font-bold text-warn tabular-nums">
                    {pending} לאישור
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label={`כל ה${activeKind === 'fault' ? 'תקלות' : 'אירועים'}`}
            value={kindIncidents.length}
          />
          <Metric
            label="פתוחים"
            value={openCount}
            tone={openCount ? 'warn' : 'normal'}
          />
          <Metric label="בטיפול" value={workingCount} tone="brand" />
          <Metric
            label="קריטיים פתוחים"
            value={criticalCount}
            tone={criticalCount ? 'hard' : 'normal'}
          />
        </div>
      </SectionCard>

      {pendingApprovals.length > 0 ? (
        <SectionCard
          title="ממתינים לאישור מנהל"
          subtitle={`${pendingApprovals.length} דיווחי תקלה מפורטל העובדים — האישור פותח אותם ביומן.`}
        >
          <div className="space-y-3">
            {pendingApprovals.map((item) => {
              const lane = data.lanes.find(
                (candidate) => candidate.id === item.laneId,
              )
              const severity = SEVERITIES.find(
                (entry) => entry.id === item.severity,
              )!
              return (
                <article
                  key={item.id}
                  className="rounded-xl border border-warn/30 bg-warn-soft/30 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severity.color}`}
                    >
                      {severity.label}
                    </span>
                    <span className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-warn ring-1 ring-warn/30">
                      ממתין לאישור
                    </span>
                    {lane ? (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
                        <Wrench className="size-3.5" />
                        {lane.name}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="text-base font-bold text-ink">{item.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                    {item.description}
                  </p>
                  <p className="mt-2 text-[12px] text-ink-soft">
                    דווח על ידי {item.reportedByName || item.createdBy} ·{' '}
                    {formatDate(item.createdAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary !py-2 text-xs"
                      onClick={() => {
                        void reviewWorkerFault(item.id, 'approve').catch(
                          (err) => {
                            window.alert(
                              err instanceof Error
                                ? err.message
                                : 'אישור הדיווח נכשל',
                            )
                          },
                        )
                      }}
                    >
                      <Check className="size-3.5" aria-hidden />
                      אישור ופתיחת תקלה
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary !py-2 text-xs"
                      onClick={() => {
                        const reason = window.prompt(
                          'סיבת הדחייה (אופציונלי):',
                        )
                        if (reason === null) return
                        void reviewWorkerFault(item.id, 'reject', reason).catch(
                          (err) => {
                            window.alert(
                              err instanceof Error
                                ? err.message
                                : 'דחיית הדיווח נכשלה',
                            )
                          },
                        )
                      }}
                    >
                      <X className="size-3.5" aria-hidden />
                      דחייה
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </SectionCard>
      ) : null}

      {editor ? (
        <SectionCard
          title={
            editingId
              ? 'עריכת דיווח'
              : `דיווח ${editor.kind === 'fault' ? 'תקלה' : 'אירוע'} חדש`
          }
          subtitle="תעדו מה קרה, היכן, ומה נעשה כדי לטפל בכך."
          actions={
            <button
              className="ui-btn ui-btn-ghost"
              type="button"
              onClick={() => setEditor(null)}
              aria-label="סגירה"
            >
              <X className="size-4" />
            </button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="סוג הדיווח">
              <select
                className="ui-field"
                value={editor.kind}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    kind: e.target.value as IncidentKind,
                  })
                }
              >
                <option value="event">אירוע</option>
                <option value="fault">תקלה</option>
              </select>
            </Field>
            <Field label="כותרת *">
              <input
                className="ui-field"
                value={editor.title}
                onChange={(e) =>
                  setEditor({ ...editor, title: e.target.value })
                }
                placeholder="למשל: תקלה בשער צפוני"
              />
            </Field>
            <Field label="עמדה קשורה">
              <select
                className="ui-field"
                value={editor.laneId}
                onChange={(e) =>
                  setEditor({ ...editor, laneId: e.target.value })
                }
              >
                <option value="">ללא עמדה מסוימת</option>
                {data.lanes
                  .filter((lane) => lane.id !== 'gate-manager')
                  .map((lane) => (
                    <option key={lane.id} value={lane.id}>
                      {lane.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="תיאור האירוע *" className="sm:col-span-2">
              <textarea
                className="ui-field min-h-24 resize-y"
                value={editor.description}
                onChange={(e) =>
                  setEditor({ ...editor, description: e.target.value })
                }
                placeholder="מה קרה? מי או מה הושפע?"
              />
            </Field>
            <Field label="חומרה">
              <select
                className="ui-field"
                value={editor.severity}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    severity: e.target.value as IncidentSeverity,
                  })
                }
              >
                {SEVERITIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="סטטוס טיפול">
              <select
                className="ui-field"
                value={editor.status}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    status: e.target.value as IncidentStatus,
                  })
                }
              >
                {EDITOR_STATUSES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="תאריך המשמרת">
              <input
                className="ui-field"
                type="date"
                value={editor.shiftDate}
                onChange={(e) =>
                  setEditor({ ...editor, shiftDate: e.target.value })
                }
              />
            </Field>
            <Field label="סוג משמרת">
              <select
                className="ui-field"
                value={editor.shiftType}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    shiftType: e.target.value as ShiftType | '',
                  })
                }
              >
                <option value="">לא צוין</option>
                {SHIFT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SHIFT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="הטיפול שבוצע / מה נותר לעשות" className="sm:col-span-2">
              <textarea
                className="ui-field min-h-20 resize-y"
                value={editor.handlingNotes}
                onChange={(e) =>
                  setEditor({ ...editor, handlingNotes: e.target.value })
                }
                placeholder="פעולות שבוצעו, אחראי להמשך, ומה עדיין פתוח"
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() => setEditor(null)}
            >
              ביטול
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={save}
              disabled={!editor.title.trim() || !editor.description.trim()}
            >
              שמירת דיווח
            </button>
          </div>
        </SectionCard>
      ) : null}

      {statusFilter !== 'resolved' ? (
        <SectionCard
          title={
            activeKind === 'fault'
              ? 'תקלות פתוחות ובטיפול'
              : 'יומן אירועים'
          }
          subtitle={`${visible.length} דיווחים${
            activeKind === 'fault'
              ? ` · ${resolvedFaults.length} שטופלו בטבלה נפרדת`
              : ''
          }`}
          actions={
            activeKind === 'fault' ? (
              <button
                type="button"
                className="ui-btn ui-btn-secondary !py-1.5 text-xs"
                onClick={() =>
                  downloadIncidentsCsv(visible, data.lanes, {
                    filenamePrefix: 'faults-open',
                  })
                }
                disabled={!visible.length}
              >
                <Download className="size-3.5" aria-hidden /> ייצוא פתוחות
              </button>
            ) : undefined
          }
        >
          <IncidentFilters
            query={query}
            onQuery={setQuery}
            statusFilter={statusFilter}
            onStatus={setStatusFilter}
            severityFilter={severityFilter}
            onSeverity={setSeverityFilter}
            statusOptions={
              activeKind === 'fault'
                ? STATUSES.filter(
                    (item) =>
                      item.id !== 'pending_approval' && item.id !== 'resolved',
                  )
                : STATUSES.filter((item) => item.id !== 'pending_approval')
            }
          />
          {visible.length === 0 ? (
            <EmptyState
              title={
                kindIncidents.length
                  ? 'לא נמצאו דיווחים'
                  : activeKind === 'fault'
                    ? 'אין תקלות פתוחות'
                    : 'עדיין אין אירועים ביומן'
              }
              text={
                kindIncidents.length
                  ? 'נסו לשנות את החיפוש או את הסינון.'
                  : activeKind === 'fault'
                    ? 'דווחו על תקלה או אשרו דיווח מעובד כדי לתעד את חומרתה והטיפול בה.'
                    : 'דווחו על אירוע תפעולי כדי שמנהלים יוכלו לתעד אותו ולעקוב אחריו.'
              }
              action={
                !kindIncidents.length ? (
                  <button
                    className="ui-btn ui-btn-primary"
                    type="button"
                    onClick={() => openEditor()}
                  >
                    <Plus className="size-4" /> דיווח {kindLabel}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <IncidentList
              items={visible}
              lanes={data.lanes}
              onEdit={openEditor}
              onDelete={deleteIncident}
            />
          )}
        </SectionCard>
      ) : null}

      {showResolvedFaults ? (
        <SectionCard
          title="תקלות שטופלו"
          subtitle={`${resolvedFaults.length} תקלות סגורות — ארכיון נפרד מהיומן הפעיל`}
          actions={
            <button
              type="button"
              className="ui-btn ui-btn-secondary !py-1.5 text-xs"
              onClick={() =>
                downloadIncidentsCsv(resolvedFaults, data.lanes, {
                  filenamePrefix: 'faults-resolved',
                })
              }
              disabled={!resolvedFaults.length}
            >
              <Download className="size-3.5" aria-hidden /> ייצוא שטופלו (
              {resolvedFaults.length})
            </button>
          }
        >
          {statusFilter === 'resolved' ? (
            <IncidentFilters
              query={query}
              onQuery={setQuery}
              statusFilter={statusFilter}
              onStatus={setStatusFilter}
              severityFilter={severityFilter}
              onSeverity={setSeverityFilter}
              statusOptions={STATUSES.filter(
                (item) =>
                  item.id === 'resolved' ||
                  item.id === 'open' ||
                  item.id === 'in_progress' ||
                  item.id === 'rejected',
              )}
            />
          ) : null}
          {resolvedFaults.length === 0 ? (
            <EmptyState
              title="אין תקלות שטופלו"
              text="כשתקלה תסומן כ«טופל», היא תופיע כאן עם ייצוא נפרד."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[40rem] border-collapse text-start text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-brand/[0.045]">
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                      כותרת
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                      חומרה
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                      עמדה
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                      טיפול
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                      עודכן
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold text-ink-soft">
                      פעולות
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resolvedFaults.map((item, index) => {
                    const lane = data.lanes.find(
                      (candidate) => candidate.id === item.laneId,
                    )
                    const severity = SEVERITIES.find(
                      (entry) => entry.id === item.severity,
                    )!
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-line/50 last:border-b-0 ${
                          index % 2 === 1 ? 'bg-surface/50' : 'bg-card'
                        }`}
                      >
                        <td className="px-3 py-2.5 align-middle">
                          <p className="font-semibold text-ink">{item.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-soft">
                            {item.description}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${severity.color}`}
                          >
                            {severity.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle text-ink-soft">
                          {lane?.name ?? '—'}
                        </td>
                        <td className="max-w-[14rem] px-3 py-2.5 align-middle text-ink-soft">
                          <p className="line-clamp-2">
                            {item.handlingNotes?.trim() || '—'}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 align-middle text-[12px] text-ink-soft whitespace-nowrap">
                          {formatDate(item.updatedAt)}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="ui-btn ui-btn-ghost !px-2"
                              onClick={() => openEditor(item)}
                              aria-label={`עריכת ${item.title}`}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className="ui-btn ui-btn-ghost !px-2 text-hard"
                              onClick={() => {
                                if (window.confirm('למחוק את הדיווח מהיומן?'))
                                  deleteIncident(item.id)
                              }}
                              aria-label={`מחיקת ${item.title}`}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  )
}

function IncidentFilters({
  query,
  onQuery,
  statusFilter,
  onStatus,
  severityFilter,
  onSeverity,
  statusOptions,
}: {
  query: string
  onQuery: (value: string) => void
  statusFilter: 'all' | IncidentStatus
  onStatus: (value: 'all' | IncidentStatus) => void
  severityFilter: 'all' | IncidentSeverity
  onSeverity: (value: 'all' | IncidentSeverity) => void
  statusOptions: { id: IncidentStatus; label: string }[]
}) {
  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
      <label className="relative block">
        <Search
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
          aria-hidden
        />
        <input
          className="ui-field pe-9"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="חיפוש לפי כותרת, תיאור או עמדה"
          aria-label="חיפוש אירועים"
        />
      </label>
      <select
        className="ui-field"
        value={statusFilter}
        onChange={(e) => onStatus(e.target.value as 'all' | IncidentStatus)}
        aria-label="סינון לפי סטטוס"
      >
        <option value="all">כל הסטטוסים</option>
        {statusOptions.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
        {!statusOptions.some((item) => item.id === 'resolved') ? (
          <option value="resolved">טופל (ארכיון)</option>
        ) : null}
      </select>
      <select
        className="ui-field"
        value={severityFilter}
        onChange={(e) =>
          onSeverity(e.target.value as 'all' | IncidentSeverity)
        }
        aria-label="סינון לפי חומרה"
      >
        <option value="all">כל רמות החומרה</option>
        {SEVERITIES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function IncidentList({
  items,
  lanes,
  onEdit,
  onDelete,
}: {
  items: IncidentRecord[]
  lanes: { id: string; name: string }[]
  onEdit: (item: IncidentRecord) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const lane = lanes.find((candidate) => candidate.id === item.laneId)
        const severity = SEVERITIES.find((entry) => entry.id === item.severity)!
        return (
          <article
            key={item.id}
            className="rounded-xl border border-line/80 bg-surface/60 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severity.color}`}
                  >
                    {severity.label}
                  </span>
                  <span className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-line">
                    {statusLabel(item.status)}
                  </span>
                  {lane ? (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
                      <Wrench className="size-3.5" />
                      {lane.name}
                    </span>
                  ) : null}
                  {item.shiftDate ? (
                    <span className="text-xs text-ink-soft">
                      {item.shiftDate}
                      {item.shiftType
                        ? ` · ${SHIFT_TYPE_LABELS[item.shiftType]}`
                        : ''}
                    </span>
                  ) : null}
                </div>
                <h3 className="text-base font-bold text-ink">{item.title}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                  {item.description}
                </p>
                {item.reportedByName ? (
                  <p className="mt-1 text-xs text-ink-soft">
                    דווח מפורטל עובדים על ידי {item.reportedByName}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost !px-2"
                  onClick={() => onEdit(item)}
                  aria-label={`עריכת ${item.title}`}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost !px-2 text-hard"
                  onClick={() => {
                    if (window.confirm('למחוק את הדיווח מהיומן?'))
                      onDelete(item.id)
                  }}
                  aria-label={`מחיקת ${item.title}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            {item.handlingNotes ? (
              <div className="mt-3 rounded-lg border border-line/60 bg-card px-3 py-2.5">
                <p className="mb-1 text-xs font-semibold text-ink">
                  <ShieldAlert className="me-1 inline size-3.5" />
                  טיפול והמשך
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                  {item.handlingNotes}
                </p>
              </div>
            ) : null}
            {item.rejectionReason ? (
              <p className="mt-2 text-sm text-hard">
                סיבת דחייה: {item.rejectionReason}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line/60 pt-2.5 text-[11px] text-ink-soft">
              <span>
                נפתח: {item.createdBy} · {formatDate(item.createdAt)}
              </span>
              {item.updatedAt !== item.createdAt ? (
                <span>
                  עודכן: {item.updatedBy} · {formatDate(item.updatedAt)}
                </span>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'normal',
}: {
  label: string
  value: number
  tone?: 'normal' | 'warn' | 'hard' | 'brand'
}) {
  const styles = {
    normal: 'text-ink',
    warn: 'text-warn',
    hard: 'text-hard',
    brand: 'text-brand',
  }
  return (
    <div className="rounded-xl border border-line/70 bg-surface/70 p-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${styles[tone]}`}>
        {value}
      </p>
    </div>
  )
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  )
}
