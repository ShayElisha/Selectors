import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AnchoredMenu } from '../components/AnchoredMenu'
import { notify } from '../lib/notify'
import {
  EmptyState,
  FieldError,
  FieldLabel,
  IntensityBadge,
  Ltr,
  SectionCard,
  Skeleton,
} from '../components/ui'
import { pluralizeHe } from '../lib/hebrew'
import { isGateManagerLane, managedLanes } from '../lib/gateManager'
import {
  QUALIFIED_THIN_MARGIN,
  compareLanes,
  coverageTone,
  formsLaneEqual,
  isDuplicateLaneName,
  laneHistoryCount,
  orderedLaneCerts,
  qualifiedCountForLane,
  summarizeLanes,
  typedNameMatches,
  type CoverageTone,
  type LaneSortKey,
  type SortDir,
} from '../lib/lanesCertHelpers'
import type { Intensity, Lane, StaffingStandard } from '../types'
import {
  clampStaffingStandard,
  MAX_LANE_STAFFING,
} from '../lib/shiftStaffing'

const emptyForm = (): Omit<Lane, 'id'> => ({
  name: '',
  staffingStandard: 1,
  requiredCertifications: [],
  intensity: 'medium',
  afternoonHandoff: false,
})

function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmDisabled,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: React.ReactNode
  confirmLabel: string
  confirmDisabled?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => cancelRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      previouslyFocused.current?.focus?.()
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4 no-print"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)] animate-fade-up sm:p-5"
      >
        <h3
          id={titleId}
          className="font-display text-base font-bold text-ink sm:text-lg"
        >
          {title}
        </h3>
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-soft">
          {children}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="ui-btn ui-btn-secondary min-h-10 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            ביטול
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className={`ui-btn min-h-10 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 ${
              danger
                ? 'border border-hard bg-hard text-white hover:bg-hard/90'
                : 'ui-btn-primary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function CoverageChip({
  qualified,
  active,
  standard,
}: {
  qualified: number
  active: number
  standard: number
}) {
  const tone: CoverageTone = coverageTone(qualified, standard)
  const wrap =
    tone === 'error'
      ? 'bg-hard-soft text-hard ring-hard/20'
      : tone === 'warn'
        ? 'bg-warn-soft text-warn ring-warn/20'
        : 'bg-surface text-ink-soft ring-line'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold tabular-nums ring-1 ${wrap}`}
      title={
        tone === 'error'
          ? 'פחות מוסמכים מתקן הנתיב'
          : tone === 'warn'
            ? `כיסוי דק (≤ תקן + ${QUALIFIED_THIN_MARGIN})`
            : undefined
      }
    >
      {tone !== 'ok' ? (
        <AlertTriangle className="size-3 shrink-0" aria-hidden />
      ) : null}
      מוסמכים: {qualified} מתוך {active}
    </span>
  )
}

function OpenCertChip() {
  return (
    <span
      className="inline-flex items-center rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line"
      title="אין דרישת הסמכה — כל בודק פעיל יכול להשתבץ"
    >
      פתוח לכל הבודקים
    </span>
  )
}

function LaneForm({
  title,
  form,
  setForm,
  catalog,
  lanes,
  workers,
  excludeId,
  dirty,
  onSave,
  onCancel,
}: {
  title: string
  form: Omit<Lane, 'id'>
  setForm: React.Dispatch<React.SetStateAction<Omit<Lane, 'id'>>>
  catalog: string[]
  lanes: Lane[]
  workers: import('../types').Worker[]
  excludeId?: string
  dirty: boolean
  onSave: () => void
  onCancel: () => void
}) {
  const firstRef = useRef<HTMLInputElement>(null)
  const nameId = useId()
  const nameErrId = useId()
  const [touched, setTouched] = useState(false)
  const baselineIntensity = useRef<Intensity | null>(null)
  const baselineCerts = useRef<string[] | null>(null)
  const baselineStd = useRef<StaffingStandard | null>(null)

  useEffect(() => {
    if (baselineIntensity.current === null) {
      baselineIntensity.current = form.intensity
      baselineCerts.current = [...form.requiredCertifications]
      baselineStd.current = form.staffingStandard
    }
  }, [form])

  const nameError = !form.name.trim()
    ? 'נא להזין שם נתיב'
    : isDuplicateLaneName(lanes, form.name, excludeId)
      ? 'שם נתיב כבר קיים'
      : null
  const valid = !nameError
  const coverage = qualifiedCountForLane(form, workers)
  const tone = coverageTone(coverage.qualified, form.staffingStandard)

  const intensityChanged =
    baselineIntensity.current != null &&
    form.intensity !== baselineIntensity.current
  const certsChanged =
    baselineCerts.current != null &&
    (baselineCerts.current.length !== form.requiredCertifications.length ||
      !baselineCerts.current.every((c) =>
        form.requiredCertifications.includes(c),
      ))
  const stdChanged =
    baselineStd.current != null &&
    form.staffingStandard !== baselineStd.current

  useEffect(() => {
    const t = window.setTimeout(() => firstRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="ui-panel animate-fade-up border-brand/20 bg-surface p-4 sm:rounded-2xl">
      <h3 className="ui-title mb-4 text-sm sm:text-base">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldLabel htmlFor={nameId}>
            שם הנתיב <span className="text-hard">*</span>
          </FieldLabel>
          <input
            ref={firstRef}
            id={nameId}
            className="ui-field bg-card"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            aria-invalid={Boolean(touched && nameError) || undefined}
            aria-describedby={touched && nameError ? nameErrId : undefined}
            required
          />
          <span id={nameErrId}>
            <FieldError message={touched ? nameError : null} />
          </span>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-soft sm:text-sm">
            תקן מקסימלי
          </p>
          <p className="mb-1.5 text-[11px] text-ink-soft">
            בבחירת נתיבים בשיבוץ אפשר לבחור עד הכמות הזו (1…{MAX_LANE_STAFFING}).
          </p>
          <div
            className="inline-flex items-center gap-2 rounded-xl bg-card p-1 ring-1 ring-line"
            role="group"
            aria-label="תקן מקסימלי"
          >
            <button
              type="button"
              aria-label="הקטן תקן מקסימלי"
              disabled={form.staffingStandard <= 1}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  staffingStandard: clampStaffingStandard(f.staffingStandard - 1),
                }))
              }
              className="inline-flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-surface disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Minus className="size-4" aria-hidden />
            </button>
            <span className="min-w-[5.5rem] text-center text-[13px] font-semibold tabular-nums text-ink">
              {form.staffingStandard === 1
                ? 'עד בודק אחד'
                : form.staffingStandard === 2
                  ? 'עד שני בודקים'
                  : `עד ${form.staffingStandard} בודקים`}
            </span>
            <button
              type="button"
              aria-label="הגדל תקן מקסימלי"
              disabled={form.staffingStandard >= MAX_LANE_STAFFING}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  staffingStandard: clampStaffingStandard(f.staffingStandard + 1),
                }))
              }
              className="inline-flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-surface disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-soft sm:text-sm">
            דרגת עצימות
          </p>
          <div
            role="radiogroup"
            aria-label="דרגת עצימות"
            className="flex flex-wrap gap-1.5"
          >
            {(['easy', 'medium', 'hard'] as const).map((value) => {
              const on = form.intensity === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setForm((f) => ({ ...f, intensity: value }))}
                  className={`rounded-xl p-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    on ? 'ring-2 ring-brand/40' : ''
                  }`}
                >
                  <IntensityBadge intensity={value} />
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[13px] text-ink-soft">
            העצימות משמשת בחישובי עומס וספירת משמרות קשות ברוטציה.
          </p>
        </div>

        <div className="sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-3 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">החלפת צהריים</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pe-4 text-[13px] text-ink-soft">
                <li>מי שמגיע לצהריים בלבד</li>
                <li>מי שהיה בנתיב הזה בבוקר</li>
                <li>ממשיך אחר ממשמרת ארוכה</li>
              </ol>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(form.afternoonHandoff)}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  afternoonHandoff: !f.afternoonHandoff,
                }))
              }
              className={`relative h-8 w-14 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                form.afternoonHandoff ? 'bg-accent' : 'bg-line'
              }`}
            >
              <span
                className={`absolute top-1 size-6 rounded-full bg-card shadow transition-all ${
                  form.afternoonHandoff ? 'start-7' : 'start-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-xs font-medium text-ink-soft sm:text-sm">
            הסמכות נדרשות
          </p>
          <p className="mb-2 text-[13px] text-ink-soft">
            ללא בחירה = נתיב פתוח לכל הבודקים
          </p>
          <div className="flex flex-wrap gap-2">
            {catalog.map((c) => {
              const on = form.requiredCertifications.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      requiredCertifications: on
                        ? f.requiredCertifications.filter((x) => x !== c)
                        : [...f.requiredCertifications, c],
                    }))
                  }
                  className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    on
                      ? 'bg-brand text-white shadow-sm'
                      : 'bg-card text-ink-soft ring-1 ring-line hover:text-ink'
                  }`}
                >
                  {on ? <Check className="size-3.5" aria-hidden /> : null}
                  {c}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <CoverageChip
          qualified={coverage.qualified}
          active={coverage.active}
          standard={form.staffingStandard}
        />
      </div>

      {intensityChanged ? (
        <p className="mt-3 text-[13px] text-ink-soft" role="status">
          שינוי עצימות ישפיע על חישובי העומס של משמרות קודמות
        </p>
      ) : null}
      {certsChanged ? (
        <p className="mt-2 text-[13px] text-ink-soft" role="status">
          אחרי שמירה: מוסמכים{' '}
          <Ltr>
            {coverage.qualified}/{coverage.active}
          </Ltr>
        </p>
      ) : null}
      {stdChanged && tone === 'error' ? (
        <p
          className="mt-2 flex items-start gap-1.5 text-[13px] font-medium text-hard"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          התקן גבוה ממספר המוסמכים הפעילים
        </p>
      ) : null}
      {tone === 'error' ? (
        <p
          className="mt-2 flex items-start gap-1.5 text-[13px] font-medium text-warn"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          אזהרה: פחות מוסמכים מתקן הנתיב — ניתן לשמור בכל זאת
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!dirty || !valid}
          onClick={() => {
            setTouched(true)
            if (!dirty || !valid) return
            onSave()
          }}
          className="ui-btn ui-btn-primary disabled:opacity-40"
        >
          שמירה
        </button>
        <button type="button" onClick={onCancel} className="ui-btn ui-btn-ghost">
          ביטול
        </button>
      </div>
    </div>
  )
}

function RowMenu({
  lane,
  onEdit,
  onDelete,
}: {
  lane: Lane
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative no-print" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`פעולות עבור נתיב ${lane.name}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      <AnchoredMenu open={open} anchorRef={btnRef} width={168}>
        <button
          type="button"
          role="menuitem"
          className="flex w-full px-3 py-2.5 text-start text-[13px] font-semibold text-ink hover:bg-surface"
          onClick={() => {
            setOpen(false)
            onEdit()
          }}
        >
          עריכה
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[13px] font-semibold text-hard hover:bg-hard-soft"
          onClick={() => {
            setOpen(false)
            onDelete()
          }}
        >
          <Trash2 className="size-3.5" aria-hidden />
          מחיקה
        </button>
      </AnchoredMenu>
    </div>
  )
}

function SortHeader({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  className = '',
}: {
  label: string
  colKey: LaneSortKey
  sortKey: LaneSortKey | null
  sortDir: SortDir
  onSort: (k: LaneSortKey) => void
  className?: string
}) {
  const active = sortKey === colKey
  const ariaSort = active
    ? sortDir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-2 py-2 text-start text-[12px] font-semibold text-ink-soft ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  )
}

export function LanesPage() {
  const { data, loading, error, addLane, updateLane, deleteLane } = useApp()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [baseline, setBaseline] = useState(emptyForm())
  const [sortKey, setSortKey] = useState<LaneSortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [deleteTarget, setDeleteTarget] = useState<Lane | null>(null)
  const [deleteTyped, setDeleteTyped] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const dirty = !formsLaneEqual(form, baseline)
  const editingLane = editingId
    ? data.lanes.find((l) => l.id === editingId) ?? null
    : null

  const managed = useMemo(() => managedLanes(data.lanes), [data.lanes])

  const qualifiedById = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of managed) {
      map.set(l.id, qualifiedCountForLane(l, data.workers).qualified)
    }
    return map
  }, [managed, data.workers])

  const summary = useMemo(() => summarizeLanes(managed), [managed])

  const rows = useMemo(() => {
    const list = [...managed]
    if (!sortKey) return list
    return list.sort((a, b) =>
      compareLanes(a, b, sortKey, sortDir, qualifiedById),
    )
  }, [managed, sortKey, sortDir, qualifiedById])

  const showToast = useCallback((msg: string) => {
    notify.success(msg)
  }, [])

  const closeForm = useCallback(() => {
    setCreating(false)
    setEditingId(null)
    setForm(emptyForm())
    setBaseline(emptyForm())
    window.setTimeout(() => returnFocusRef.current?.focus?.(), 0)
  }, [])

  const requestCloseOrNav = useCallback(
    (next: () => void) => {
      if (dirty && (creating || editingId)) {
        setPendingNav(() => next)
        setDiscardOpen(true)
        return
      }
      next()
    },
    [dirty, creating, editingId],
  )

  const openCreate = () => {
    requestCloseOrNav(() => {
      returnFocusRef.current = document.activeElement as HTMLElement
      setEditingId(null)
      const blank = emptyForm()
      setForm(blank)
      setBaseline(blank)
      setCreating(true)
    })
  }

  const openEdit = (l: Lane) => {
    requestCloseOrNav(() => {
      returnFocusRef.current = document.activeElement as HTMLElement
      setCreating(false)
      const next: Omit<Lane, 'id'> = {
        name: l.name,
        staffingStandard: l.staffingStandard,
        requiredCertifications: [...l.requiredCertifications],
        intensity: l.intensity,
        afternoonHandoff: Boolean(l.afternoonHandoff),
      }
      setForm(next)
      setBaseline(next)
      setEditingId(l.id)
    })
  }

  useEffect(() => {
    if (!dirty || !(creating || editingId)) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, creating, editingId])

  const save = () => {
    if (!form.name.trim()) return
    if (isGateManagerLane({ name: form.name })) {
      notify.error('«מנהל שער» היא עמדת מערכת — לא ניתן להוסיף נתיב בשם זה')
      return
    }
    if (isDuplicateLaneName(data.lanes, form.name, editingLane?.id)) return
    if (editingLane && isGateManagerLane(editingLane)) return
    const payload = {
      ...form,
      name: form.name.trim(),
      afternoonHandoff: Boolean(form.afternoonHandoff) || undefined,
    }
    if (editingLane) {
      updateLane({
        ...editingLane,
        ...payload,
        afternoonHandoff: Boolean(form.afternoonHandoff) || undefined,
      })
      showToast('הנתיב עודכן')
    } else {
      addLane({
        ...payload,
        afternoonHandoff: Boolean(form.afternoonHandoff) || undefined,
      })
      showToast('הנתיב נוסף')
    }
    closeForm()
  }

  const historyForDelete = deleteTarget
    ? laneHistoryCount(data.history, deleteTarget.id)
    : 0

  const formPanel =
    creating || editingLane ? (
      <LaneForm
        title={creating ? 'נתיב חדש' : 'עריכת נתיב'}
        form={form}
        setForm={setForm}
        catalog={data.certificationsCatalog}
        lanes={data.lanes}
        workers={data.workers}
        excludeId={editingLane?.id}
        dirty={dirty}
        onSave={save}
        onCancel={() => requestCloseOrNav(() => closeForm())}
      />
    ) : null

  if (loading && data.lanes.length === 0) {
    return (
      <SectionCard title="נתיבים ועמדות" subtitle="תקן מקסימלי, הסמכות, עצימות והחלפת צהריים">
        <div className="space-y-2" aria-busy aria-label="טוען נתיבים">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </SectionCard>
    )
  }

  return (
    <div className="lanes-print-root space-y-4">
      <SectionCard
        title="נתיבים ועמדות"
        subtitle="תקן מקסימלי, הסמכות, עצימות והחלפת צהריים"
        printRoot
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="ui-btn ui-btn-primary !px-2.5 !py-1.5 text-xs sm:!px-3 sm:!py-2 sm:text-sm"
          >
            <Plus className="size-3.5 sm:size-4" aria-hidden />
            הוספת נתיב
          </button>
        }
      >
        {error ? (
          <p className="mb-3 text-[13px] font-medium text-hard" role="alert">
            {error}
          </p>
        ) : null}

        {creating ? <div className="mb-4 no-print">{formPanel}</div> : null}

        {managed.length === 0 && !creating ? (
          <EmptyState
            title="עדיין אין נתיבים"
            text="הוסיפו נתיבים כדי להגדיר תקן מקסימלי והסמכות לשיבוץ."
            action={
              <button
                type="button"
                onClick={openCreate}
                className="ui-btn ui-btn-primary"
              >
                <Plus className="size-3.5" aria-hidden />
                הוספת נתיב
              </button>
            }
          />
        ) : null}

        {managed.length > 0 ? (
          <>
            <p className="mb-3 text-[13px] text-ink-soft tabular-nums">
              {pluralizeHe(summary.count, {
                one: 'נתיב אחד',
                two: 'שני נתיבים',
                many: 'נתיבים',
              })}{' '}
              · תקן מקס׳ כולל{' '}
              <Ltr>{summary.totalStandard}</Ltr> ·{' '}
              <Ltr>{summary.easy}</Ltr> קל · <Ltr>{summary.medium}</Ltr> בינוני ·{' '}
              <Ltr>{summary.hard}</Ltr> קשה
            </p>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line">
                    <SortHeader
                      label="נתיב"
                      colKey="name"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={(k) => {
                        if (sortKey === k)
                          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else {
                          setSortKey(k)
                          setSortDir('asc')
                        }
                      }}
                    />
                    <SortHeader
                      label="עצימות"
                      colKey="intensity"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={(k) => {
                        if (sortKey === k)
                          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else {
                          setSortKey(k)
                          setSortDir('asc')
                        }
                      }}
                    />
                    <SortHeader
                      label="תקן מקס׳"
                      colKey="standard"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={(k) => {
                        if (sortKey === k)
                          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else {
                          setSortKey(k)
                          setSortDir('asc')
                        }
                      }}
                    />
                    <th
                      scope="col"
                      className="px-2 py-2 text-start text-[12px] font-semibold text-ink-soft"
                    >
                      הסמכות
                    </th>
                    <SortHeader
                      label="החלפה"
                      colKey="handoff"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={(k) => {
                        if (sortKey === k)
                          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else {
                          setSortKey(k)
                          setSortDir('asc')
                        }
                      }}
                      className="no-print"
                    />
                    <SortHeader
                      label="מוסמכים"
                      colKey="qualified"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={(k) => {
                        if (sortKey === k)
                          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else {
                          setSortKey(k)
                          setSortDir('asc')
                        }
                      }}
                    />
                    <th scope="col" className="px-2 py-2 no-print">
                      <span className="sr-only">פעולות</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => {
                    if (editingId === l.id) {
                      return (
                        <tr key={l.id}>
                          <td colSpan={7} className="p-2 no-print">
                            {formPanel}
                          </td>
                        </tr>
                      )
                    }
                    const cov = qualifiedCountForLane(l, data.workers)
                    const certs = orderedLaneCerts(
                      data.certificationsCatalog,
                      l.requiredCertifications,
                    )
                    return (
                      <tr key={l.id} className="h-14 border-b border-line/70">
                        <td className="px-2 py-1.5 font-semibold text-ink">
                          {l.name}
                        </td>
                        <td className="px-2 py-1.5">
                          <IntensityBadge intensity={l.intensity} />
                        </td>
                        <td className="px-2 py-1.5 text-ink-soft tabular-nums">
                          {l.staffingStandard === 1
                            ? 'בודק אחד'
                            : pluralizeHe(l.staffingStandard, {
                                one: 'בודק אחד',
                                two: 'שני בודקים',
                                many: 'בודקים',
                              })}
                        </td>
                        <td className="px-2 py-1.5">
                          {certs.length === 0 ? (
                            <OpenCertChip />
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {certs.map((c) => (
                                <span
                                  key={c}
                                  className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line"
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 no-print">
                          {l.afternoonHandoff ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold text-accent ring-1 ring-accent/20">
                              <ArrowLeftRight
                                className="size-3"
                                aria-hidden
                              />
                              החלפת צהריים
                            </span>
                          ) : (
                            <span className="text-ink-soft">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <CoverageChip
                            qualified={cov.qualified}
                            active={cov.active}
                            standard={l.staffingStandard}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-end no-print">
                          <RowMenu
                            lane={l}
                            onEdit={() => openEdit(l)}
                            onDelete={() => {
                              setDeleteTyped('')
                              setDeleteTarget(l)
                            }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <ul className="space-y-2 md:hidden">
              {rows.map((l) => {
                if (editingId === l.id) {
                  return (
                    <li key={l.id} className="no-print">
                      {formPanel}
                    </li>
                  )
                }
                const cov = qualifiedCountForLane(l, data.workers)
                const certs = orderedLaneCerts(
                  data.certificationsCatalog,
                  l.requiredCertifications,
                )
                return (
                  <li
                    key={l.id}
                    className="rounded-xl border border-line/70 bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-ink">{l.name}</span>
                          <IntensityBadge intensity={l.intensity} />
                          {l.afternoonHandoff ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold text-accent">
                              <ArrowLeftRight className="size-3" aria-hidden />
                              החלפת צהריים
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[13px] text-ink-soft tabular-nums">
                          תקן מקס׳:{' '}
                          {l.staffingStandard === 1
                            ? 'בודק אחד'
                            : `${l.staffingStandard} בודקים`}
                        </p>
                        <div className="mt-2">
                          {certs.length === 0 ? (
                            <OpenCertChip />
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {certs.map((c) => (
                                <span
                                  key={c}
                                  className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line"
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="mt-2">
                          <CoverageChip
                            qualified={cov.qualified}
                            active={cov.active}
                            standard={l.staffingStandard}
                          />
                        </div>
                      </div>
                      <RowMenu
                        lane={l}
                        onEdit={() => openEdit(l)}
                        onDelete={() => {
                          setDeleteTyped('')
                          setDeleteTarget(l)
                        }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="מחיקת נתיב"
        confirmLabel="מחיקה"
        danger
        confirmDisabled={
          deleteTarget
            ? historyForDelete > 0 &&
              !typedNameMatches(deleteTyped, deleteTarget.name)
            : false
        }
        onCancel={() => {
          setDeleteTarget(null)
          setDeleteTyped('')
        }}
        onConfirm={() => {
          if (!deleteTarget || isGateManagerLane(deleteTarget)) return
          deleteLane(deleteTarget.id)
          if (editingId === deleteTarget.id) closeForm()
          setDeleteTarget(null)
          setDeleteTyped('')
          showToast('הנתיב נמחק מהמאגר')
        }}
      >
        {deleteTarget ? (
          <>
            <p>
              למחוק את נתיב <strong>{deleteTarget.name}</strong> מהמאגר?
            </p>
            <p>
              זו מחיקה סופית מהרשימה בלבד. משמרות שמורות נשארות עם מזהה הנתיב —
              בחישובי עומס/רוטציה נתיב שנמחק לא ייספר (מדלגים עליו).
            </p>
            {historyForDelete > 0 ? (
              <>
                <p>
                  לנתיב זה יש{' '}
                  <span className="tabular-nums font-semibold text-ink">
                    {historyForDelete}
                  </span>{' '}
                  משמרות בהיסטוריה. להמשך הקלידו את שם הנתיב:
                </p>
                <label className="mt-1 block text-[13px] font-medium text-ink">
                  הקלידו «{deleteTarget.name}»
                  <input
                    className="ui-field mt-1.5 bg-card"
                    value={deleteTyped}
                    onChange={(e) => setDeleteTyped(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            ) : (
              <p>לא נמצאו משמרות שמורות עבור נתיב זה.</p>
            )}
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={discardOpen}
        title="שינויים שלא נשמרו"
        confirmLabel="יציאה ללא שמירה"
        danger
        onCancel={() => {
          setDiscardOpen(false)
          setPendingNav(null)
        }}
        onConfirm={() => {
          const next = pendingNav
          setDiscardOpen(false)
          setPendingNav(null)
          setCreating(false)
          setEditingId(null)
          setForm(emptyForm())
          setBaseline(emptyForm())
          next?.()
        }}
      >
        <p>יש שינויים שלא נשמרו. לצאת בלי לשמור?</p>
      </ConfirmDialog>
    </div>
  )
}
