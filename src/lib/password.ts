export const PASSWORD_MIN_LENGTH = 8

export type PasswordRuleId = 'length' | 'upper' | 'digit' | 'symbol'

export const PASSWORD_RULES: {
  id: PasswordRuleId
  label: string
  test: (password: string) => boolean
}[] = [
  {
    id: 'length',
    label: `לפחות ${PASSWORD_MIN_LENGTH} תווים`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'upper',
    label: 'לפחות אות גדולה אחת באנגלית (A–Z)',
    test: (p) => /[A-Z]/.test(p),
  },
  {
    id: 'digit',
    label: 'לפחות ספרה אחת',
    test: (p) => /[0-9]/.test(p),
  },
  {
    id: 'symbol',
    label: 'לפחות סימן מיוחד אחד (!@# וכו׳)',
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
]

export function validatePasswordRules(password: string): string | null {
  if (!password) return 'נא להזין סיסמה'
  for (const rule of PASSWORD_RULES) {
    if (!rule.test(password)) return rule.label
  }
  return null
}

export function passwordMeetsAllRules(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password))
}
