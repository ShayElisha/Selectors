import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Eye, EyeOff, LogIn, Mail } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AppFooter } from '../components/AppFooter'
import { BrandMark } from '../components/BrandMark'
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
  | 'verify_email'
  | 'await_email'
  | 'reset'
  | 'reset_sent'
  | 'pending_approval'
  | 'rejected'
  | 'suspended'
  | 'no_modules'

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
  const { login, verifyLoginCode, checkLogin, requestPasswordReset } = useApp()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [emailHint, setEmailHint] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
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
    setChallengeId('')
    setEmailHint('')
    setVerificationCode('')
    setShowPassword(false)
    setShowNewPassword(false)
    setShowConfirm(false)
  }

  const beginEmailVerification = (result: {
    challengeId: string
    emailHint: string
  }) => {
    setPassword('')
    setNewPassword('')
    setNewPasswordConfirm('')
    setChallengeId(result.challengeId)
    setEmailHint(result.emailHint)
    setVerificationCode('')
    setInfo(null)
    setStep('verify_email')
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
      const result = await checkLogin(phoneTrimmed)
      if (result.next === 'login' || result.next === 'change_password') {
        setStep(result.next === 'change_password' ? 'change_password' : 'login')
        return
      }
      if (
        result.next === 'pending_approval' ||
        result.next === 'rejected' ||
        result.next === 'suspended' ||
        result.next === 'no_modules'
      ) {
        setInfo(result.message || null)
        setStep(result.next)
        return
      }
      resetPasswordFields()
      setStep(result.next)
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
        return
      }
      if (next && typeof next === 'object') {
        if (next.next === 'verify_email') {
          beginEmailVerification(next)
          return
        }
        setInfo(next.message || null)
        setStep(next.next)
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
      const result = await login(phoneTrimmed, password, {
        newPassword,
        newPasswordConfirm,
      })
      if (result && typeof result === 'object' && result.next === 'verify_email') {
        beginEmailVerification(result)
      } else if (result && typeof result === 'object') {
        setInfo(result.message || null)
        setStep(result.next)
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'שמירת הסיסמה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const submitVerificationCode = async () => {
    if (!challengeId || !/^\d{6}$/.test(verificationCode)) {
      setError('נא להזין קוד אימות בן 6 ספרות')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await verifyLoginCode(challengeId, verificationCode)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'אימות הקוד נכשל')
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
    if (step === 'verify_email') {
      await submitVerificationCode()
      return
    }
    if (step === 'reset') {
      await submitReset()
    }
  }

  const subtitle = {
    phone: 'התחברות עם מספר הטלפון והסיסמה הקיימת',
    login: 'התחברות עם מספר הטלפון והסיסמה הקיימת',
    change_password: 'הסיסמה הזו זמנית. יש להגדיר סיסמה קבועה חדשה',
    verify_email: 'השלימו את ההתחברות עם קוד חד־פעמי',
    await_email: 'לחשבון הזה עדיין אין סיסמה',
    reset: 'איפוס סיסמה — נשלח מייל עם קוד זמני',
    reset_sent: 'בדקו את תיבת המייל',
    pending_approval: 'הארגון עדיין לא אושר',
    rejected: 'בקשת הארגון נדחתה',
    suspended: 'הגישה לארגון מושעית',
    no_modules: 'הארגון אושר, והמודולים עדיין סגורים',
  }[step]

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10 sm:py-12">
      <div className="mb-4 flex justify-end">
        <ThemeToggle />
      </div>
      <div className="ui-panel-solid p-5 sm:rounded-[1.25rem] sm:p-8">
        <BrandMark variant="full" className="mx-auto mb-4 h-36" />
        <p className="ui-subtitle mt-2 text-center text-xs sm:text-sm">{subtitle}</p>

        <form onSubmit={submit} className="mt-6 space-y-4 sm:mt-7" noValidate>
          {(step === 'phone' ||
            step === 'login' ||
            step === 'change_password' ||
            step === 'await_email' ||
            step === 'reset' ||
            step === 'reset_sent' ||
            step === 'pending_approval' ||
            step === 'rejected' ||
            step === 'suspended' ||
            step === 'no_modules') && (
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

          {step === 'verify_email' && (
            <>
              <div className="rounded-xl border border-line bg-surface/80 px-3 py-3 text-xs text-ink-soft sm:text-sm">
                <p className="flex items-start gap-2">
                  <Mail className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  הזינו את הקוד בן 6 הספרות שנשלח לכתובת {emailHint}. הקוד תקף
                  ל־10 דקות וניתן להשתמש בו פעם אחת בלבד.
                </p>
              </div>
              <div>
                <FieldLabel htmlFor="login-verification-code">קוד אימות</FieldLabel>
                <input
                  id="login-verification-code"
                  className="ui-field text-center font-mono text-lg tracking-[0.35em]"
                  type="text"
                  value={verificationCode}
                  onChange={(event) => {
                    setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    if (error) setError(null)
                  }}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  disabled={busy}
                  required
                />
              </div>
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

          {(step === 'pending_approval' ||
            step === 'rejected' ||
            step === 'suspended' ||
            step === 'no_modules') &&
            info && (
              <p className="rounded-xl border border-line bg-surface/80 px-3 py-3 text-xs text-ink-soft sm:text-sm">
                {info}
              </p>
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

          {step !== 'await_email' &&
            step !== 'reset_sent' &&
            step !== 'pending_approval' &&
            step !== 'rejected' &&
            step !== 'suspended' &&
            step !== 'no_modules' && (
            <button
              type="submit"
              disabled={
                busy ||
                (step === 'change_password' &&
                  (!passwordMeetsAllRules(newPassword) ||
                    newPassword !== newPasswordConfirm)) ||
                (step === 'verify_email' && verificationCode.length !== 6)
              }
              className="ui-btn ui-btn-primary w-full py-2.5 sm:py-3"
            >
              {busy ? (
                <>
                  <span className="page-loader page-loader--sm" aria-hidden />
                  {step === 'reset' || (step === 'phone' && !password)
                    ? 'שולח…'
                    : step === 'verify_email'
                      ? 'מאמת…'
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
              ) : step === 'verify_email' ? (
                <>
                  <LogIn className="size-4" aria-hidden />
                  אימות והתחברות
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

          {(step === 'phone' || step === 'login' || step === 'reset') && (
            <Link
              to="/register"
              className="block text-center text-sm font-semibold text-brand underline underline-offset-2"
            >
              הרשמת ארגון חדש
            </Link>
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
