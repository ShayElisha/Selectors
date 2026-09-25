import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Eye, EyeOff, LogIn, Mail } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AppFooter } from '../components/AppFooter'
import { ThemeToggle } from '../components/ThemeToggle'
import { FieldError, FieldLabel } from '../components/ui'
import { notify } from '../lib/notify'
import {
  PASSWORD_RULES,
  passwordMeetsAllRules,
  validatePasswordRules,
} from '../lib/password'

type Step =
  | 'phone'
  | 'login'
  | 'change_password'
  | 'await_email'
  | 'reset'
  | 'reset_sent'

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
  invalid,
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
  invalid?: boolean
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
          aria-invalid={invalid || undefined}
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

export function LoginPage() {
  const { login, checkLogin, requestPasswordReset } = useApp()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const phoneTrimmed = phone.trim()
  const phoneInvalid = touched && (step === 'phone' || step === 'reset') && !phoneTrimmed

  const ruleStates = useMemo(
    () =>
      PASSWORD_RULES.map((rule) => ({
        ...rule,
        ok: rule.test(newPassword),
      })),
    [newPassword],
  )

  const resetPasswordFields = () => {
    setPassword('')
    setNewPassword('')
    setNewPasswordConfirm('')
    setShowPassword(false)
    setShowNewPassword(false)
    setShowConfirm(false)
  }

  const submitPhone = async () => {
    setTouched(true)
    if (!phoneTrimmed) {
      setError('נא להזין מספר טלפון')
      return
    }
    if (password) {
      await submitLogin()
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const next = await checkLogin(phoneTrimmed)
      if (next === 'login') {
        setStep('login')
        return
      }
      resetPasswordFields()
      setStep(next)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'בדיקת מספר נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const submitLogin = async () => {
    if (!password) {
      setError('נא להזין סיסמה')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await login(phoneTrimmed, password)
      if (next === 'change_password') {
        setNewPassword('')
        setNewPasswordConfirm('')
        setStep('change_password')
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'התחברות נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const submitChangePassword = async () => {
    const ruleError = validatePasswordRules(newPassword)
    if (ruleError) {
      setError(ruleError)
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setError('אימות הסיסמה אינו תואם')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await login(phoneTrimmed, password, {
        newPassword,
        newPasswordConfirm,
      })
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'שמירת הסיסמה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const submitReset = async () => {
    setTouched(true)
    if (!phoneTrimmed) {
      setError('נא להזין מספר טלפון')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const message = await requestPasswordReset(phoneTrimmed)
      setInfo(message)
      setStep('reset_sent')
      notify.success('נשלח מייל לאיפוס סיסמה')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'איפוס הסיסמה נכשל')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 'phone') {
      await submitPhone()
      return
    }
    if (step === 'login') {
      await submitLogin()
      return
    }
    if (step === 'change_password') {
      await submitChangePassword()
      return
    }
    if (step === 'reset') {
      await submitReset()
    }
  }

  const subtitle =
    step === 'phone' || step === 'login'
      ? 'התחברות עם מספר הטלפון והסיסמה הקיימת'
      : step === 'change_password'
          ? 'הסיסמה הזו זמנית. יש להגדיר סיסמה קבועה חדשה'
          : step === 'await_email'
            ? 'לחשבון הזה עדיין אין סיסמה'
            : step === 'reset'
              ? 'איפוס סיסמה — נשלח מייל עם קוד זמני'
              : 'בדקו את תיבת המייל'

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10 sm:py-12">
      <div className="mb-4 flex justify-end">
        <ThemeToggle />
      </div>
      <div className="ui-panel-solid p-5 sm:rounded-[1.25rem] sm:p-8">
        <p className="ui-eyebrow mb-1">CHECK IN</p>
        <h1 className="font-display text-[1.85rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">
          שיבוצון
        </h1>
        <p className="ui-subtitle mt-2 text-xs sm:text-sm">{subtitle}</p>

        <form onSubmit={submit} className="mt-6 space-y-4 sm:mt-7" noValidate>
          {(step === 'phone' ||
            step === 'login' ||
            step === 'change_password' ||
            step === 'await_email' ||
            step === 'reset' ||
            step === 'reset_sent') && (
            <div>
              <FieldLabel htmlFor="login-phone">מספר טלפון</FieldLabel>
              <input
                id="login-phone"
                className="ui-field"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  if (error) setError(null)
                  if (step !== 'phone' && step !== 'reset') {
                    setStep('phone')
                    resetPasswordFields()
                    setInfo(null)
                  }
                }}
                onBlur={() => setTouched(true)}
                placeholder="05XXXXXXXX"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                required
                disabled={busy || step === 'reset_sent'}
              />
            </div>
          )}

          {(step === 'phone' || step === 'login') && (
            <PasswordField
              id="login-password"
              label="סיסמה"
              value={password}
              onChange={(v) => {
                setPassword(v)
                if (error) setError(null)
              }}
              show={showPassword}
              onToggleShow={() => setShowPassword((s) => !s)}
              autoComplete="current-password"
              disabled={busy}
              invalid={Boolean(error)}
            />
          )}

          {step === 'change_password' && (
            <>
              <PasswordField
                id="login-new-password"
                label="סיסמה קבועה חדשה"
                value={newPassword}
                onChange={(v) => {
                  setNewPassword(v)
                  if (error) setError(null)
                }}
                show={showNewPassword}
                onToggleShow={() => setShowNewPassword((s) => !s)}
                autoComplete="new-password"
                disabled={busy}
                describedBy="login-password-rules"
                invalid={Boolean(error)}
              />
              <PasswordField
                id="login-new-password-confirm"
                label="אימות סיסמה"
                value={newPasswordConfirm}
                onChange={(v) => {
                  setNewPasswordConfirm(v)
                  if (error) setError(null)
                }}
                show={showConfirm}
                onToggleShow={() => setShowConfirm((s) => !s)}
                autoComplete="new-password"
                disabled={busy}
                invalid={Boolean(error)}
              />
              <ul
                id="login-password-rules"
                className="space-y-1.5 rounded-xl border border-line bg-surface/80 px-3 py-2.5 text-[11px] sm:text-xs"
              >
                {ruleStates.map((rule) => (
                  <li
                    key={rule.id}
                    className={`flex items-center gap-2 ${
                      rule.ok ? 'text-ok' : 'text-ink-soft'
                    }`}
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full ${
                        rule.ok
                          ? 'bg-ok text-white'
                          : 'bg-line/80 text-transparent'
                      }`}
                      aria-hidden
                    >
                      <Check className="size-2.5 stroke-[3]" />
                    </span>
                    {rule.label}
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 'await_email' && (
            <div className="rounded-xl border border-line bg-surface/80 px-3 py-3 text-xs text-ink-soft sm:text-sm">
              <p className="flex items-start gap-2">
                <Mail className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                טרם הוגדרה סיסמה לחשבון. לאחר מינוי מנהל נשלחת סיסמה זמנית
                למייל. אפשר גם לבקש איפוס סיסמה למטה.
              </p>
            </div>
          )}

          {step === 'reset_sent' && info && (
            <p className="rounded-xl border border-ok/30 bg-ok-soft px-3 py-2.5 text-xs text-ok sm:text-sm">
              {info}
            </p>
          )}

          <div id="login-form-error">
            <FieldError
              message={
                phoneInvalid ? 'נא להזין מספר טלפון' : error
              }
            />
          </div>

          {step !== 'await_email' && step !== 'reset_sent' && (
            <button
              type="submit"
              disabled={
                busy ||
                (step === 'change_password' &&
                  (!passwordMeetsAllRules(newPassword) ||
                    newPassword !== newPasswordConfirm))
              }
              className="ui-btn ui-btn-primary w-full py-2.5 sm:py-3"
            >
              {busy ? (
                <>
                  <span className="page-loader page-loader--sm" aria-hidden />
                  {step === 'reset' || (step === 'phone' && !password)
                    ? 'שולח…'
                    : 'מתחבר…'}
                </>
              ) : step === 'phone' && !password ? (
                'המשך'
              ) : step === 'reset' ? (
                <>
                  <Mail className="size-4" aria-hidden />
                  שליחת סיסמה זמנית למייל
                </>
              ) : step === 'change_password' ? (
                <>
                  <LogIn className="size-4" aria-hidden />
                  שמירת סיסמה והתחברות
                </>
              ) : (
                <>
                  <LogIn className="size-4" aria-hidden />
                  התחברות
                </>
              )}
            </button>
          )}

          {step === 'await_email' && (
            <button
              type="button"
              className="ui-btn ui-btn-primary w-full"
              disabled={busy}
              onClick={() => {
                setStep('reset')
                setError(null)
              }}
            >
              <Mail className="size-4" aria-hidden />
              בקשת סיסמה זמנית למייל
            </button>
          )}

          {step === 'reset_sent' && (
            <button
              type="button"
              className="ui-btn ui-btn-primary w-full"
              onClick={() => {
                setStep('login')
                setInfo(null)
                resetPasswordFields()
              }}
            >
              המשך להתחברות
            </button>
          )}

          {(step === 'phone' || step === 'login' || step === 'await_email') && (
            <button
              type="button"
              className="ui-btn ui-btn-ghost w-full text-xs"
              disabled={busy}
              onClick={() => {
                setStep('reset')
                setError(null)
                setInfo(null)
              }}
            >
              שכחתי סיסמה
            </button>
          )}

          {step !== 'phone' && step !== 'reset_sent' && (
            <button
              type="button"
              className="ui-btn ui-btn-ghost w-full text-xs"
              disabled={busy}
              onClick={() => {
                setStep('phone')
                resetPasswordFields()
                setError(null)
                setInfo(null)
              }}
            >
              חזרה
            </button>
          )}

          <p className="text-center text-[11px] leading-relaxed text-ink-soft sm:text-xs">
            בהתחברות חלה{' '}
            <Link
              to="/privacy"
              className="font-bold text-brand underline underline-offset-2"
            >
              מדיניות השימוש והפרטיות
            </Link>
          </p>
        </form>
      </div>

      <AppFooter className="mt-10" />
    </div>
  )
}
