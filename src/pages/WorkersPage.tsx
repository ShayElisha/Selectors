import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Mail,
  MoreHorizontal,
  PauseCircle,
  Plus,
  Power,
  Search,
  Shield,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AnchoredMenu } from '../components/AnchoredMenu'
import {
  EmptyState,
  FieldError,
  FieldLabel,
  Ltr,
  SectionCard,
  Skeleton,
} from '../components/ui'
import { pluralizeHe } from '../lib/hebrew'
import {
  RARE_CERT_HOLDER_THRESHOLD,
  certHolderCounts,
  compareWorkers,
  countByStatus,
  filterWorkers,
  findDuplicateWorkers,
  formatIsraeliMobile,
  formsEqual,
  isRareCert,
  isValidEmail,
  lanesOpenedByCert,
  noCertTooltip,
  orderedCertifications,
  personInitials,
  typedNameMatches,
  validateWorkerForm,
  workerShiftHistoryCount,
  type SortDir,
  type StatusTab,
  type WorkerSortKey,
} from '../lib/workersHelpers'
import { notify } from '../lib/notify'
import type { Lane, Worker, WorkerStatus } from '../types'

const emptyForm = (): Omit<Worker, 'id'> => ({
  fullName: '',
  phone: '',
  email: '',
  certifications: [],
  status: 'active',
  isInspector: true,
  isManager: false,
})

type DialogKind =
  | { type: 'delete'; worker: Worker }
  | { type: 'deactivate'; worker: Worker }
  | { type: 'activate'; worker: Worker }
  | { type: 'grantAdmin'; name: string; email: string }
  | { type: 'revokeAdmin'; name: string }
  | { type: 'discard' }
  | { type: 'resendMail' }

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
  const confirmRef = useRef<HTMLButtonElement>(null)
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
            ref={confirmRef}
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

function SegmentedTwo<T extends string>({
  value,
  onChange,
  options,
  label,
  name,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  name: string
}) {
  const groupId = useId()
  return (
    <fieldset>
      <legend className="mb-1.5 block text-xs font-medium text-ink-soft sm:text-sm">
        {label}
      </legend>
      <div
        role="radiogroup"
        aria-labelledby={groupId}
        className="inline-flex w-full rounded-xl bg-surface p-1 ring-1 ring-line sm:w-auto"
      >
        <span id={groupId} className="sr-only">
          {label}
        </span>
        {options.map((opt) => {
          const on = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              name={name}
              onClick={() => onChange(opt.value)}
              className={`min-h-10 flex-1 rounded-lg px-3 text-[13px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-none sm:px-4 ${
                on
                  ? 'bg-card text-ink shadow-sm ring-1 ring-line'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function WorkerAvatar({ name }: { name: string }) {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white"
      aria-hidden
    >
      {personInitials(name)}
    </span>
  )
}

function ManagerBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold text-accent ring-1 ring-accent/20">
      <Shield className="size-3" aria-hidden />
      מנהל
    </span>
  )
}

function InspectorBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-bold text-ink-soft ring-1 ring-line">
      <UserRound className="size-3" aria-hidden />
      בודק
    </span>
  )
}

function RoleBadges({ worker }: { worker: Worker }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {worker.isInspector ? <InspectorBadge /> : null}
      {worker.isManager ? <ManagerBadge /> : null}
    </span>
  )
}

function InactiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-bold text-ink-soft ring-1 ring-line">
      <Ban className="size-3" aria-hidden />
      לא פעיל
    </span>
  )
}

function CertDisplay({
  held,
  catalog,
  lanes,
  holderCounts,
}: {
  held: string[]
  catalog: string[]
  lanes: Lane[]
  holderCounts: Map<string, number>
}) {
  if (held.length === 0) {
    return (
      <span
        className="inline-flex items-center rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line"
        title={noCertTooltip(lanes)}
      >
        ללא הסמכה
      </span>
    )
  }
  const ordered = orderedCertifications(catalog, held)
  return (
    <div className="flex flex-wrap gap-1">
      {ordered.map((c) => {
        const opened = lanesOpenedByCert(lanes, c)
        const holders = holderCounts.get(c) ?? 0
        const rare = isRareCert(holders)
        const tip = [
          opened > 0 ? `פותח ${opened} נתיבים` : null,
          rare
            ? `נדירה — פחות מ־${RARE_CERT_HOLDER_THRESHOLD} מחזיקים (גמישות שיבוץ מוגבלת)`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <span
            key={c}
            title={tip || undefined}
            className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line"
          >
            {c}
            {rare ? (
              <span className="text-[10px] font-bold text-warn">נדירה</span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}

function WorkerForm({
  title,
  form,
  setForm,
  catalog,
  workers,
  excludeId,
  dirty,
  saveError,
  mailBusy,
  mailMessage,
  onSave,
  onCancel,
  onResendMail,
  showResend,
}: {
  title: string
  form: Omit<Worker, 'id'>
  setForm: React.Dispatch<React.SetStateAction<Omit<Worker, 'id'>>>
  catalog: string[]
  workers: Worker[]
  excludeId?: string
  dirty: boolean
  saveError: string | null
  mailBusy: boolean
  mailMessage: string | null
  onSave: () => void
  onCancel: () => void
  onResendMail?: () => void
  showResend: boolean
}) {
  const firstRef = useRef<HTMLInputElement>(null)
  const nameId = useId()
  const phoneId = useId()
  const emailId = useId()
  const nameErrId = useId()
  const phoneErrId = useId()
  const emailErrId = useId()

  const [touched, setTouched] = useState(false)
  const errors = validateWorkerForm(form)
  const valid = Object.keys(errors).length === 0
  const dups = findDuplicateWorkers(
    workers,
    { fullName: form.fullName, phone: form.phone },
    excludeId,
  )
  const showErrors = touched || dirty
  const showNameErr = showErrors && errors.fullName
  const showPhoneErr = showErrors && errors.phone
  const showEmailErr = showErrors && errors.email

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
        <div>
          <FieldLabel htmlFor={nameId}>
            שם מלא <span className="text-hard">*</span>
          </FieldLabel>
          <input
            ref={firstRef}
            id={nameId}
            className="ui-field bg-card"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            aria-invalid={Boolean(showNameErr) || undefined}
            aria-describedby={showNameErr ? nameErrId : undefined}
            required
          />
          <FieldError message={showNameErr ? errors.fullName : null} />
          {showNameErr ? (
            <span id={nameErrId} className="sr-only">
              {errors.fullName}
            </span>
          ) : null}
        </div>
        <div>
          <FieldLabel htmlFor={phoneId}>
            טלפון <span className="text-hard">*</span>
          </FieldLabel>
          <bdi dir="ltr" className="block">
            <input
              id={phoneId}
              className="ui-field w-full bg-card text-start"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              aria-invalid={Boolean(showPhoneErr) || undefined}
              aria-describedby={showPhoneErr ? phoneErrId : undefined}
              inputMode="tel"
              autoComplete="tel"
              required
            />
          </bdi>
          <FieldError message={showPhoneErr ? errors.phone : null} />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel htmlFor={emailId}>
            מייל
            {form.isManager ? (
              <>
                {' '}
                <span className="text-hard">*</span>
              </>
            ) : null}
          </FieldLabel>
          <bdi dir="ltr" className="block">
            <input
              id={emailId}
              className="ui-field w-full bg-card text-start"
              type="email"
              value={form.email || ''}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              aria-invalid={Boolean(showEmailErr) || undefined}
              aria-describedby={showEmailErr ? emailErrId : undefined}
              placeholder="name@example.com"
              autoComplete="email"
              required={form.isManager}
            />
          </bdi>
          <FieldError message={showEmailErr ? errors.email : null} />
          {form.isManager ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-ink-soft">
              <Mail className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
              נדרש מייל. סיסמה זמנית תישלח לכתובת שתזין
            </p>
          ) : null}
        </div>

        <SegmentedTwo
          label="סטטוס"
          name="worker-status"
          value={form.status}
          onChange={(status: WorkerStatus) =>
            setForm((f) => ({ ...f, status }))
          }
          options={[
            { value: 'active', label: 'פעיל' },
            { value: 'inactive', label: 'לא פעיל' },
          ]}
        />

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-soft sm:text-sm">
            תפקיד
          </p>
          <p className="mb-2 text-[11px] text-ink-soft">
            בודק נכלל בשיבוץ ובסטטיסטיקות. מנהל מקבל גישה למערכת. אפשר לבחור
            את שניהם.
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="תפקיד"
          >
            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold ring-1 transition ${
                form.isInspector
                  ? 'bg-brand-soft text-brand-deep ring-brand/30'
                  : 'bg-card text-ink-soft ring-line hover:bg-surface'
              }`}
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-brand)]"
                checked={form.isInspector}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isInspector: e.target.checked }))
                }
              />
              בודק
            </label>
            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold ring-1 transition ${
                form.isManager
                  ? 'bg-accent-soft text-accent ring-accent/30'
                  : 'bg-card text-ink-soft ring-line hover:bg-surface'
              }`}
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={form.isManager}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isManager: e.target.checked }))
                }
              />
              מנהל
            </label>
          </div>
          <FieldError message={showErrors && errors.role ? errors.role : null} />
        </div>

        <div className="sm:col-span-2">
          <p className="mb-2 text-xs font-medium text-ink-soft sm:text-sm">
            הסמכות
          </p>
          <div className="flex flex-wrap gap-2">
            {catalog.map((c) => {
              const on = form.certifications.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      certifications: on
                        ? f.certifications.filter((x) => x !== c)
                        : [...f.certifications, c],
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault()
                      ;(e.currentTarget as HTMLButtonElement).click()
                    }
                  }}
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

      {(dups.samePhone.length > 0 || dups.sameName.length > 0) && (
        <p
          className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn ring-1 ring-warn/20"
          role="status"
        >
          {dups.samePhone.length > 0 && dups.sameName.length > 0
            ? 'אזהרה: קיים בודק עם אותו טלפון ואותו שם — ניתן לשמור בכל זאת.'
            : dups.samePhone.length > 0
              ? 'אזהרה: קיים בודק עם אותו מספר טלפון — ניתן לשמור בכל זאת.'
              : 'אזהרה: קיים בודק עם אותו שם — ניתן לשמור בכל זאת.'}
        </p>
      )}

      {saveError ? (
        <p className="mt-3 text-[13px] font-medium text-hard" role="alert">
          {saveError}
        </p>
      ) : null}
      {mailMessage ? (
        <p className="mt-2 text-[13px] text-ink-soft" role="status">
          {mailMessage}
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
        {showResend && onResendMail ? (
          <button
            type="button"
            onClick={onResendMail}
            disabled={mailBusy}
            className="ui-btn ui-btn-ghost"
          >
            <Mail className="size-3.5" aria-hidden />
            {mailBusy ? 'שולח…' : 'שליחת סיסמה זמנית למייל'}
          </button>
        ) : null}
        <button type="button" onClick={onCancel} className="ui-btn ui-btn-ghost">
          ביטול
        </button>
      </div>
    </div>
  )
}

function RowMenu({
  worker,
  onEdit,
  onDeactivate,
  onActivate,
  onDelete,
}: {
  worker: Worker
  onEdit: () => void
  onDeactivate: () => void
  onActivate: () => void
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
        aria-label={`פעולות עבור ${worker.fullName}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      <AnchoredMenu open={open} anchorRef={btnRef} width={176}>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[13px] font-semibold text-ink hover:bg-surface"
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
          >
            <UserRound className="size-3.5" aria-hidden />
            עריכה
          </button>
          {worker.status === 'active' ? (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[13px] font-semibold text-ink hover:bg-surface"
              onClick={() => {
                setOpen(false)
                onDeactivate()
              }}
            >
              <PauseCircle className="size-3.5" aria-hidden />
              השבתה
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[13px] font-semibold text-ink hover:bg-surface"
              onClick={() => {
                setOpen(false)
                onActivate()
              }}
            >
              <Power className="size-3.5" aria-hidden />
              הפעלה
            </button>
          )}
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
  colKey: WorkerSortKey
  sortKey: WorkerSortKey | null
  sortDir: SortDir
  onSort: (k: WorkerSortKey) => void
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

export function WorkersPage() {
  const {
    data,
    loading,
    error,
    addWorker,
    updateWorker,
    deleteWorker,
    resendManagerTempPassword,
  } = useApp()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [baseline, setBaseline] = useState(emptyForm())
  const [query, setQuery] = useState('')
  const [statusTab, setStatusTab] = useState<StatusTab>('active')
  const [roleFilter, setRoleFilter] = useState<'all' | 'manager' | 'inspector'>(
    'all',
  )
  const [certFilters, setCertFilters] = useState<string[]>([])
  const [sortKey, setSortKey] = useState<WorkerSortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [deleteTyped, setDeleteTyped] = useState('')
  const [pendingSave, setPendingSave] = useState<Omit<Worker, 'id'> | null>(
    null,
  )
  const [mailBusy, setMailBusy] = useState(false)
  const [mailMessage, setMailMessage] = useState<string | null>(null)
  const [formSaveError, setFormSaveError] = useState<string | null>(null)
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const dirty = !formsEqual(form, baseline)
  const editingWorker = editingId
    ? data.workers.find((w) => w.id === editingId) ?? null
    : null

  const statusCounts = useMemo(
    () => countByStatus(data.workers),
    [data.workers],
  )
  const holderCounts = useMemo(
    () => certHolderCounts(data.workers, data.certificationsCatalog),
    [data.workers, data.certificationsCatalog],
  )

  const filtered = useMemo(() => {
    const list = filterWorkers(data.workers, {
      query,
      statusTab,
      role: roleFilter,
      certs: certFilters,
    })
    if (!sortKey) return list
    return [...list].sort((a, b) => compareWorkers(a, b, sortKey, sortDir))
  }, [
    data.workers,
    query,
    statusTab,
    roleFilter,
    certFilters,
    sortKey,
    sortDir,
  ])

  const showToast = useCallback((msg: string) => {
    notify.success(msg)
  }, [])

  const closeForm = useCallback(() => {
    setCreating(false)
    setEditingId(null)
    setForm(emptyForm())
    setBaseline(emptyForm())
    setMailMessage(null)
    setFormSaveError(null)
    window.setTimeout(() => returnFocusRef.current?.focus?.(), 0)
  }, [])

  const requestCloseOrNav = useCallback(
    (next: () => void) => {
      if (dirty && (creating || editingId)) {
        setPendingNav(() => next)
        setDialog({ type: 'discard' })
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
      setMailMessage(null)
      setFormSaveError(null)
      setCreating(true)
    })
  }

  const openEdit = (w: Worker, trigger?: HTMLElement | null) => {
    requestCloseOrNav(() => {
      returnFocusRef.current =
        trigger ?? (document.activeElement as HTMLElement)
      setCreating(false)
      const next: Omit<Worker, 'id'> = {
        fullName: w.fullName,
        phone: w.phone,
        email: w.email || '',
        certifications: [...w.certifications],
        status: w.status,
        isInspector: Boolean(w.isInspector) || !w.isManager,
        isManager: Boolean(w.isManager),
      }
      setForm(next)
      setBaseline(next)
      setMailMessage(null)
      setFormSaveError(null)
      setEditingId(w.id)
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

  const commitSave = (payload: Omit<Worker, 'id'>) => {
    const normalized = {
      ...payload,
      fullName: payload.fullName.trim(),
      phone: formatIsraeliMobile(payload.phone),
      email: payload.email?.trim() || '',
    }
    try {
      if (editingWorker) {
        updateWorker({ ...editingWorker, ...normalized })
        showToast('הבודק עודכן')
      } else {
        addWorker(normalized)
        showToast('הבודק נוסף')
      }
      setBaseline(normalized)
      setForm(normalized)
      closeForm()
    } catch (e) {
      setFormSaveError(e instanceof Error ? e.message : 'שמירה נכשלה')
    }
  }

  const trySave = () => {
    const errors = validateWorkerForm(form)
    if (Object.keys(errors).length > 0) return

    const granting =
      form.isManager && (!editingWorker || !editingWorker.isManager)
    const revoking =
      Boolean(editingWorker?.isManager) && !form.isManager

    if (granting) {
      setPendingSave(form)
      setDialog({
        type: 'grantAdmin',
        name: form.fullName.trim(),
        email: (form.email || '').trim(),
      })
      return
    }
    if (revoking) {
      setPendingSave(form)
      setDialog({ type: 'revokeAdmin', name: form.fullName.trim() })
      return
    }
    commitSave(form)
  }

  const sendTempPassword = async () => {
    if (!editingWorker?.id) return
    if (!editingWorker.isManager) {
      setFormSaveError('שמרו קודם את המשתמש כמנהל עם מייל, ואז שלחו סיסמה')
      return
    }
    if (!isValidEmail(editingWorker.email || '')) {
      setFormSaveError('שמרו מייל תקין למנהל לפני שליחת סיסמה')
      return
    }
    if (dirty) {
      setMailMessage('יש שינויים שלא נשמרו — שמרו קודם ואז שלחו סיסמה זמנית')
      notify.warning('יש שינויים שלא נשמרו — שמרו קודם ואז שלחו סיסמה זמנית')
      return
    }
    setDialog({ type: 'resendMail' })
  }

  const confirmResendMail = async () => {
    if (!editingWorker?.id) return
    setDialog(null)
    setMailBusy(true)
    setMailMessage(null)
    try {
      await resendManagerTempPassword(editingWorker.id)
      setMailMessage('סיסמה זמנית נשלחה למייל')
      notify.success('סיסמה זמנית נשלחה למייל')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'שליחת המייל נכשלה'
      setMailMessage(msg)
      notify.error(msg)
    } finally {
      setMailBusy(false)
    }
  }

  const onSort = (key: WorkerSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const clearFilters = () => {
    setQuery('')
    setCertFilters([])
    setRoleFilter('all')
    setStatusTab('all')
  }

  const hasFilters =
    query.trim() !== '' ||
    certFilters.length > 0 ||
    roleFilter !== 'all' ||
    statusTab !== 'active'

  const formPanel =
    creating || editingWorker ? (
      <WorkerForm
        title={creating ? 'בודק חדש' : 'עריכת בודק'}
        form={form}
        setForm={setForm}
        catalog={data.certificationsCatalog}
        workers={data.workers}
        excludeId={editingWorker?.id}
        dirty={dirty}
        saveError={formSaveError || (error && dirty ? error : null)}
        mailBusy={mailBusy}
        mailMessage={mailMessage}
        onSave={trySave}
        onCancel={() =>
          requestCloseOrNav(() => {
            closeForm()
          })
        }
        onResendMail={() => void sendTempPassword()}
        showResend={Boolean(editingWorker?.isManager)}
      />
    ) : null

  const historyCountForDelete =
    dialog?.type === 'delete'
      ? workerShiftHistoryCount(data.history, dialog.worker.id)
      : 0

  if (loading && data.workers.length === 0) {
    return (
      <SectionCard title="מאגר בודקים" subtitle="ניהול בודקים, הסמכות והרשאות">
        <div className="space-y-2" aria-busy aria-label="טוען בודקים">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </SectionCard>
    )
  }

  return (
    <div className="workers-print-root space-y-4">
      <SectionCard
        title="מאגר בודקים"
        subtitle="ניהול בודקים, הסמכות והרשאות"
        printRoot
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="ui-btn ui-btn-primary !px-2.5 !py-1.5 text-xs sm:!px-3 sm:!py-2 sm:text-sm"
          >
            <Plus className="size-3.5 sm:size-4" aria-hidden />
            הוספת בודק
          </button>
        }
      >
        {error && !creating && !editingId ? (
          <p className="mb-3 text-[13px] font-medium text-hard" role="alert">
            {error}
          </p>
        ) : null}

        {creating ? <div className="mb-4 no-print">{formPanel}</div> : null}

        {data.workers.length === 0 && !creating ? (
          <EmptyState
            title="עדיין אין בודקים במאגר"
            text="הוסיפו בודקים כדי להתחיל בשיבוץ."
            action={
              <button
                type="button"
                onClick={openCreate}
                className="ui-btn ui-btn-primary"
              >
                <Plus className="size-3.5" aria-hidden />
                הוספת בודק
              </button>
            }
          />
        ) : null}

        {data.workers.length > 0 ? (
          <>
            <div className="mb-3 flex flex-col gap-3 no-print">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="חיפוש לפי שם או טלפון"
                  className="ui-field w-full pe-3 ps-10"
                  aria-label="חיפוש בודקים"
                />
              </div>

              <div
                role="tablist"
                aria-label="סינון לפי סטטוס"
                className="inline-flex flex-wrap gap-1 rounded-xl bg-surface p-1 ring-1 ring-line"
              >
                {(
                  [
                    {
                      id: 'active' as const,
                      label: `פעילים (${statusCounts.active})`,
                    },
                    {
                      id: 'inactive' as const,
                      label: `לא פעילים (${statusCounts.inactive})`,
                    },
                    {
                      id: 'all' as const,
                      label: `הכל (${data.workers.length})`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={statusTab === tab.id}
                    onClick={() => setStatusTab(tab.id)}
                    className={`min-h-10 rounded-lg px-3 text-[13px] font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      statusTab === tab.id
                        ? 'bg-card text-ink shadow-sm ring-1 ring-line'
                        : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium text-ink-soft">
                  הסמכות
                  <span
                    className="ms-1 font-normal"
                    title="בחירת מספר הסמכות מציגה בודקים שמחזיקים בכולן"
                  >
                    (ו־AND)
                  </span>
                  :
                </span>
                {data.certificationsCatalog.map((c) => {
                  const n = holderCounts.get(c) ?? 0
                  const on = certFilters.includes(c)
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      title="מסננים מצטברים: חייבים להחזיק בכל ההסמכות שנבחרו"
                      onClick={() =>
                        setCertFilters((prev) =>
                          on ? prev.filter((x) => x !== c) : [...prev, c],
                        )
                      }
                      className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                        on
                          ? 'bg-brand text-white'
                          : 'bg-card text-ink-soft ring-1 ring-line'
                      }`}
                    >
                      {on ? <Check className="size-3" aria-hidden /> : null}
                      {c} {n}
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium text-ink-soft">
                  תפקיד:
                </span>
                {(
                  [
                    { id: 'all' as const, label: 'הכל' },
                    { id: 'inspector' as const, label: 'בודק' },
                    { id: 'manager' as const, label: 'מנהל' },
                  ] as const
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={roleFilter === r.id}
                    onClick={() => setRoleFilter(r.id)}
                    className={`min-h-9 rounded-lg px-2.5 text-[12px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      roleFilter === r.id
                        ? 'bg-brand text-white'
                        : 'bg-card text-ink-soft ring-1 ring-line'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <p className="text-[13px] text-ink-soft tabular-nums">
                {filtered.length} מתוך{' '}
                {pluralizeHe(data.workers.length, {
                  one: 'בודק אחד',
                  two: 'שני בודקים',
                  many: 'בודקים',
                })}
              </p>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title="אין תוצאות לסינון"
                text="נסו לשנות חיפוש או לנקות מסננים."
                action={
                  hasFilters ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="ui-btn ui-btn-secondary"
                    >
                      <X className="size-3.5" aria-hidden />
                      ניקוי סינון
                    </button>
                  ) : null
                }
              />
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-line">
                        <SortHeader
                          label="בודק"
                          colKey="name"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={onSort}
                        />
                        <SortHeader
                          label="טלפון"
                          colKey="phone"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={onSort}
                          className="workers-print-col"
                        />
                        <SortHeader
                          label="מייל"
                          colKey="email"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={onSort}
                          className="no-print"
                        />
                        <th
                          scope="col"
                          className="px-2 py-2 text-start text-[12px] font-semibold text-ink-soft workers-print-col"
                        >
                          הסמכות
                        </th>
                        <SortHeader
                          label="תפקיד"
                          colKey="role"
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onSort={onSort}
                          className="no-print"
                        />
                        <th
                          scope="col"
                          className="px-2 py-2 text-start text-[12px] font-semibold text-ink-soft no-print"
                        >
                          <span className="sr-only">פעולות</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((w) => {
                        const isEditing = editingId === w.id
                        if (isEditing) {
                          return (
                            <tr key={w.id}>
                              <td colSpan={6} className="p-2 no-print">
                                {formPanel}
                              </td>
                            </tr>
                          )
                        }
                        const phone = formatIsraeliMobile(w.phone)
                        const inactive = w.status !== 'active'
                        return (
                          <tr
                            key={w.id}
                            className={`h-14 border-b border-line/70 ${
                              inactive ? 'opacity-60' : ''
                            }`}
                          >
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-2">
                                <WorkerAvatar name={w.fullName} />
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate font-semibold text-ink">
                                      {w.fullName}
                                    </span>
                                    {inactive ? <InactiveBadge /> : null}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-1.5 workers-print-col">
                              <Ltr className="text-ink-soft">{phone}</Ltr>
                            </td>
                            <td className="max-w-[11rem] px-2 py-1.5 no-print">
                              {w.email ? (
                                <a
                                  href={`mailto:${w.email}`}
                                  title={w.email}
                                  className="block truncate text-brand underline-offset-2 hover:underline"
                                  dir="ltr"
                                >
                                  <bdi>{w.email}</bdi>
                                </a>
                              ) : (
                                <span className="text-ink-soft">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 workers-print-col">
                              <CertDisplay
                                held={w.certifications}
                                catalog={data.certificationsCatalog}
                                lanes={data.lanes}
                                holderCounts={holderCounts}
                              />
                            </td>
                            <td className="px-2 py-1.5 no-print">
                              <RoleBadges worker={w} />
                            </td>
                            <td className="px-2 py-1.5 text-end no-print">
                              <RowMenu
                                worker={w}
                                onEdit={() => openEdit(w)}
                                onDeactivate={() =>
                                  setDialog({ type: 'deactivate', worker: w })
                                }
                                onActivate={() =>
                                  setDialog({ type: 'activate', worker: w })
                                }
                                onDelete={() => {
                                  setDeleteTyped('')
                                  setDialog({ type: 'delete', worker: w })
                                }}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <ul className="space-y-2 md:hidden">
                  {filtered.map((w) => {
                    const isEditing = editingId === w.id
                    if (isEditing) {
                      return (
                        <li key={w.id} className="no-print">
                          {formPanel}
                        </li>
                      )
                    }
                    const phone = formatIsraeliMobile(w.phone)
                    const inactive = w.status !== 'active'
                    return (
                      <li
                        key={w.id}
                        className={`rounded-xl border border-line/70 bg-card p-3 ${
                          inactive ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2">
                            <WorkerAvatar name={w.fullName} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-ink">
                                  {w.fullName}
                                </span>
                                <RoleBadges worker={w} />
                                {inactive ? <InactiveBadge /> : null}
                              </div>
                              <a
                                href={`tel:${phone.replace(/\D/g, '')}`}
                                className="mt-1 block text-[13px] text-brand"
                              >
                                <Ltr>{phone}</Ltr>
                              </a>
                              {w.email ? (
                                <a
                                  href={`mailto:${w.email}`}
                                  title={w.email}
                                  className="mt-0.5 block truncate text-[13px] text-ink-soft"
                                  dir="ltr"
                                >
                                  <bdi>{w.email}</bdi>
                                </a>
                              ) : null}
                              <div className="mt-2">
                                <CertDisplay
                                  held={w.certifications}
                                  catalog={data.certificationsCatalog}
                                  lanes={data.lanes}
                                  holderCounts={holderCounts}
                                />
                              </div>
                            </div>
                          </div>
                          <RowMenu
                            worker={w}
                            onEdit={() => openEdit(w)}
                            onDeactivate={() =>
                              setDialog({ type: 'deactivate', worker: w })
                            }
                            onActivate={() =>
                              setDialog({ type: 'activate', worker: w })
                            }
                            onDelete={() => {
                              setDeleteTyped('')
                              setDialog({ type: 'delete', worker: w })
                            }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </>
        ) : null}
      </SectionCard>

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="מחיקת בודק"
        confirmLabel="מחיקה"
        danger
        confirmDisabled={
          dialog?.type === 'delete'
            ? historyCountForDelete > 0 &&
              !typedNameMatches(deleteTyped, dialog.worker.fullName)
            : false
        }
        onCancel={() => {
          setDialog(null)
          setDeleteTyped('')
        }}
        onConfirm={() => {
          if (dialog?.type !== 'delete') return
          deleteWorker(dialog.worker.id)
          if (editingId === dialog.worker.id) closeForm()
          setDialog(null)
          setDeleteTyped('')
          showToast('הבודק נמחק מהמאגר')
        }}
      >
        {dialog?.type === 'delete' ? (
          <>
            <p>
              למחוק את <strong>{dialog.worker.fullName}</strong> מהמאגר?
            </p>
            <p>
              זו מחיקה סופית מהמאגר בלבד. רשומות משמרות שמורות נשארות במערכת —
              בשמות ייתכן שיופיע מזהה במקום השם.
            </p>
            {historyCountForDelete > 0 ? (
              <>
                <p>
                  לבודק זה יש{' '}
                  <span className="tabular-nums font-semibold text-ink">
                    {historyCountForDelete}
                  </span>{' '}
                  משמרות בהיסטוריה. להמשך הקלידו את השם המלא:
                </p>
                <label className="mt-1 block text-[13px] font-medium text-ink">
                  הקלידו «{dialog.worker.fullName}»
                  <input
                    className="ui-field mt-1.5 bg-card"
                    value={deleteTyped}
                    onChange={(e) => setDeleteTyped(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            ) : (
              <p>לא נמצאו משמרות שמורות עבור בודק זה.</p>
            )}
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'deactivate'}
        title="השבתת בודק"
        confirmLabel="השבתה"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type !== 'deactivate') return
          updateWorker({ ...dialog.worker, status: 'inactive' })
          setDialog(null)
          showToast('הבודק הושבת')
        }}
      >
        {dialog?.type === 'deactivate' ? (
          <>
            <p>
              להשבית את <strong>{dialog.worker.fullName}</strong>?
            </p>
            <p>
              הבודק יישמר בהיסטוריה ולא ישובץ במשמרות חדשות.
            </p>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'activate'}
        title="הפעלת בודק"
        confirmLabel="הפעלה"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type !== 'activate') return
          updateWorker({ ...dialog.worker, status: 'active' })
          setDialog(null)
          showToast('הבודק הופעל')
        }}
      >
        {dialog?.type === 'activate' ? (
          <p>
            להפעיל מחדש את <strong>{dialog.worker.fullName}</strong>? יוכל
            שוב להופיע בשיבוץ.
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'grantAdmin'}
        title="הענקת הרשאת מנהל"
        confirmLabel="הענקת הרשאה"
        onCancel={() => {
          setDialog(null)
          setPendingSave(null)
        }}
        onConfirm={() => {
          if (!pendingSave) return
          const payload = pendingSave
          setDialog(null)
          setPendingSave(null)
          commitSave(payload)
        }}
      >
        {dialog?.type === 'grantAdmin' ? (
          <p>
            להעניק הרשאת מנהל ל־<strong>{dialog.name}</strong>? תישלח סיסמה
            זמנית אל <Ltr>{dialog.email}</Ltr>.
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'revokeAdmin'}
        title="הסרת הרשאת מנהל"
        confirmLabel="הסרת הרשאה"
        danger
        onCancel={() => {
          setDialog(null)
          setPendingSave(null)
        }}
        onConfirm={() => {
          if (!pendingSave) return
          const payload = pendingSave
          setDialog(null)
          setPendingSave(null)
          commitSave(payload)
        }}
      >
        {dialog?.type === 'revokeAdmin' ? (
          <p>
            להסיר הרשאת מנהל מ־<strong>{dialog.name}</strong>? הגישה למערכת
            תיחסם.
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'discard'}
        title="שינויים שלא נשמרו"
        confirmLabel="יציאה ללא שמירה"
        danger
        onCancel={() => {
          setDialog(null)
          setPendingNav(null)
        }}
        onConfirm={() => {
          const next = pendingNav
          setDialog(null)
          setPendingNav(null)
          setCreating(false)
          setEditingId(null)
          setForm(emptyForm())
          setBaseline(emptyForm())
          setMailMessage(null)
          setFormSaveError(null)
          next?.()
        }}
      >
        <p>יש שינויים שלא נשמרו. לצאת בלי לשמור?</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'resendMail'}
        title="שליחת סיסמה זמנית"
        confirmLabel="שליחה"
        onCancel={() => setDialog(null)}
        onConfirm={() => void confirmResendMail()}
      >
        <p>
          לשלוח סיסמה זמנית חדשה למייל המנהל? הסיסמה הקודמת תבוטל.
        </p>
      </ConfirmDialog>
    </div>
  )
}
