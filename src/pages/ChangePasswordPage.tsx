import { useMemo, useState, type FormEvent } from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'
import { changePasswordRemote } from '../api'
import { FieldLabel, SectionCard } from '../components/ui'
import { notify } from '../lib/notify'
import { PASSWORD_RULES, passwordMeetsAllRules } from '../lib/password'

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  disabled,
  describedBy,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggleShow: () => void
  autoComplete: string
  disabled?: boolean
  describedBy?: string
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <input
          id={id}
          className="ui-field ps-11"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir="ltr"
          autoComplete={autoComplete}
          disabled={disabled}
          aria-describedby={describedBy}
          required
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute inset-y-0 start-0 flex items-center px-3 text-ink-soft hover:text-brand"
          aria-label={show ? 'הסתר סיסמה' : 'הצג סיסמה'}
        >
          {show ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  )
}

export function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rules = useMemo(
    () => PASSWORD_RULES.map((rule) => ({ ...rule, ok: rule.test(newPassword) })),
    [newPassword],
  )
  const mismatch = confirm.length > 0 && confirm !== newPassword
  const canSubmit =
    currentPassword.length > 0 &&
    passwordMeetsAllRules(newPassword) &&
    confirm === newPassword &&
    newPassword !== currentPassword &&
    !busy

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await changePasswordRemote({
        currentPassword,
        newPassword,
        newPasswordConfirm: confirm,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      notify.success('הסיסמה עודכנה')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'החלפת הסיסמה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="החלפת סיסמה"
      subtitle="הסיסמה החדשה מחליפה את הנוכחית מיד. אין צורך להתחבר מחדש."
    >
      <form onSubmit={(e) => void submit(e)} className="mx-auto max-w-md space-y-4">
        <PasswordField
          id="current-password"
          label="סיסמה נוכחית"
          value={currentPassword}
          onChange={setCurrentPassword}
          show={showCurrent}
          onToggleShow={() => setShowCurrent((v) => !v)}
          autoComplete="current-password"
          disabled={busy}
        />
        <PasswordField
          id="new-password"
          label="סיסמה חדשה"
          value={newPassword}
          onChange={setNewPassword}
          show={showNew}
          onToggleShow={() => setShowNew((v) => !v)}
          autoComplete="new-password"
          disabled={busy}
          describedBy="password-rules"
        />
        <ul
          id="password-rules"
          className="space-y-1.5 rounded-xl border border-line bg-surface/80 px-3 py-2.5 text-[11px] sm:text-xs"
        >
          {rules.map((rule) => (
            <li
              key={rule.id}
              className={`flex items-center gap-2 ${rule.ok ? 'text-ok' : 'text-ink-soft'}`}
            >
              <span
                className={`flex size-4 shrink-0 items-center justify-center rounded-full ${
                  rule.ok ? 'bg-ok text-white' : 'bg-line/80 text-transparent'
                }`}
                aria-hidden
              >
                <Check className="size-2.5 stroke-[3]" />
              </span>
              {rule.label}
            </li>
          ))}
        </ul>
        <PasswordField
          id="confirm-password"
          label="אימות סיסמה חדשה"
          value={confirm}
          onChange={setConfirm}
          show={showConfirm}
          onToggleShow={() => setShowConfirm((v) => !v)}
          autoComplete="new-password"
          disabled={busy}
        />
        {mismatch ? (
          <p className="text-sm font-medium text-hard" role="alert">
            אימות הסיסמה אינו תואם
          </p>
        ) : null}
        {newPassword && currentPassword && newPassword === currentPassword ? (
          <p className="text-sm font-medium text-hard" role="alert">
            הסיסמה החדשה חייבת להיות שונה מהנוכחית
          </p>
        ) : null}
        {error ? (
          <p className="text-sm font-medium text-hard" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="ui-btn ui-btn-primary disabled:opacity-40"
          disabled={!canSubmit}
        >
          {busy ? 'מעדכן…' : 'עדכון סיסמה'}
        </button>
      </form>
    </SectionCard>
  )
}
