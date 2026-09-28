import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff } from 'lucide-react'
import { registerOrganizationRemote } from '../api'
import { AppFooter } from '../components/AppFooter'
import { BrandMark } from '../components/BrandMark'
import { ThemeToggle } from '../components/ThemeToggle'
import { FieldError, FieldLabel } from '../components/ui'
import { notify } from '../lib/notify'
import { PASSWORD_RULES, validatePasswordRules } from '../lib/password'

export function RegisterPage() {
  const navigate = useNavigate()
  const [organizationName, setOrganizationName] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const ruleStates = useMemo(
    () => PASSWORD_RULES.map((rule) => ({ ...rule, ok: rule.test(password) })),
    [password],
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ruleError = validatePasswordRules(password)
    if (!organizationName.trim() || !fullName.trim() || !phone.trim() || !email.trim()) {
      setError('מלאו את כל השדות')
      return
    }
    if (ruleError) {
      setError(ruleError)
      return
    }
    if (password !== passwordConfirm) {
      setError('אימות הסיסמה אינו תואם')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await registerOrganizationRemote({
        organizationName: organizationName.trim(),
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        password,
        passwordConfirm,
      })
      setDone(result.message)
      notify.success('הבקשה נשלחה')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ההרשמה נכשלה'
      setError(message)
      notify.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10 sm:py-12">
      <div className="mb-4 flex justify-end">
        <ThemeToggle />
      </div>
      <div className="ui-panel-solid p-5 sm:rounded-[1.25rem] sm:p-8">
        <BrandMark variant="full" className="mx-auto mb-4 h-32" />
        <h1 className="text-center font-display text-[1.85rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">
          הרשמת ארגון
        </h1>
        <p className="ui-subtitle mt-2 text-center text-xs sm:text-sm">
          המנהל שנרשם כאן הוא מי שנכנס למערכת, אחרי שסופר אדמין מאשר ופותח מודול.
        </p>

        {done ? (
          <div className="mt-6 space-y-4">
            <p className="rounded-xl border border-ok/30 bg-ok-soft px-3 py-3 text-sm text-ok">
              {done}
            </p>
            <button
              type="button"
              className="ui-btn ui-btn-primary w-full"
              onClick={() => navigate('/login')}
            >
              חזרה להתחברות
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <div>
              <FieldLabel htmlFor="org-name">שם הארגון</FieldLabel>
              <input
                id="org-name"
                className="ui-field"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="manager-name">שם המנהל</FieldLabel>
              <input
                id="manager-name"
                className="ui-field"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="manager-phone">טלפון</FieldLabel>
              <input
                id="manager-phone"
                className="ui-field"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                inputMode="tel"
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="manager-email">מייל</FieldLabel>
              <input
                id="manager-email"
                className="ui-field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
                required
              />
            </div>
            <div>
              <FieldLabel htmlFor="manager-password">סיסמה</FieldLabel>
              <div className="relative">
                <input
                  id="manager-password"
                  className="ui-field ps-11"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  dir="ltr"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 start-0 flex items-center px-3 text-ink-soft hover:text-brand"
                  aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {ruleStates.map((rule) => (
                  <li
                    key={rule.id}
                    className={`flex items-center gap-2 text-[12px] ${
                      rule.ok ? 'text-ok' : 'text-ink-soft'
                    }`}
                  >
                    <span
                      className={`inline-flex size-4 items-center justify-center rounded-full ${
                        rule.ok ? 'bg-ok text-white' : 'bg-surface text-transparent'
                      }`}
                      aria-hidden
                    >
                      <Check className="size-2.5 stroke-[3]" />
                    </span>
                    {rule.label}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <FieldLabel htmlFor="manager-password-confirm">אימות סיסמה</FieldLabel>
              <input
                id="manager-password-confirm"
                className="ui-field"
                type={showPassword ? 'text' : 'password'}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                dir="ltr"
                autoComplete="new-password"
                required
              />
            </div>
            <FieldError message={error} />
            <button type="submit" className="ui-btn ui-btn-primary w-full" disabled={busy}>
              {busy ? 'שולח…' : 'שליחת בקשה לאישור'}
            </button>
            <Link
              to="/login"
              className="block text-center text-sm font-semibold text-brand underline underline-offset-2"
            >
              יש כבר חשבון? להתחברות
            </Link>
          </form>
        )}
      </div>
      <AppFooter className="mt-10" />
    </div>
  )
}
