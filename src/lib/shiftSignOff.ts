import type { ShiftSignOff } from '../types'

export function compactPersonName(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

export function namesMatchForSignOff(
  typed: string | null | undefined,
  accountName: string | null | undefined,
): boolean {
  const signature = compactPersonName(typed)
  const expected = compactPersonName(accountName)
  return signature.length > 0 && signature === expected
}

export function normalizeSignOff(value: unknown): ShiftSignOff | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<ShiftSignOff>
  const signedAt = String(raw.signedAt ?? '').trim()
  const signerName = compactPersonName(raw.signerName)
  const signature = compactPersonName(raw.signature)
  const signerId = String(raw.signerId ?? '').trim()
  if (!signedAt || !signerName || !signature) return undefined
  return { signedAt, signerName, signerId, signature }
}

export function isShiftSignedOff(
  shift: { signOff?: ShiftSignOff | null } | null | undefined,
): boolean {
  return Boolean(normalizeSignOff(shift?.signOff)?.signedAt)
}

export function formatSignOffStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('he-IL', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
