import { normalizeHeSearch } from './trackingHeatmap'
import {
  CUSTOMS_BROKERS,
} from '../data/customsBrokers'
import type { CustomsBroker, CustomsBrokerContact } from '../types'

export type { CustomsBroker, CustomsBrokerContact }

export function seedCustomsBrokers(): CustomsBroker[] {
  return CUSTOMS_BROKERS.map((b) => ({
    ...b,
    contacts: b.contacts.map((c) => ({ ...c })),
  }))
}

export function digitsOnlyPhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

/** Normalize Israeli phone to 0XXXXXXXXX digits for tel: and dedupe. */
export function normalizeBrokerPhoneDigits(phone: string): string | null {
  let digits = digitsOnlyPhone(phone)
  if (!digits) return null
  if (digits.length === 9 && digits.startsWith('5')) digits = `0${digits}`
  if (digits.length === 8 && /^[23489]/.test(digits)) digits = `0${digits}`
  if (digits.length > 10 && digits.startsWith('0')) {
    digits =
      digits.startsWith('05') || digits.startsWith('07')
        ? digits.slice(0, 10)
        : digits.slice(0, 9)
  }
  if (digits.length < 9 || digits.length > 10) return null
  if (!digits.startsWith('0')) return null
  return digits
}

export function formatBrokerPhone(digits: string): string {
  if (/^05\d{8}$/.test(digits) || /^07\d{8}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return digits
}

export function normalizeCustomsBrokerContact(
  raw: unknown,
  brokerId: string,
): CustomsBrokerContact | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const phoneRaw = String(o.phone ?? o.phoneDigits ?? '').trim()
  const digits =
    normalizeBrokerPhoneDigits(phoneRaw) ||
    normalizeBrokerPhoneDigits(String(o.phoneDigits ?? ''))
  if (!digits) return null
  const id =
    String(o.id || '').trim() || `${brokerId}-${digits}`
  return {
    id,
    name: String(o.name || '').trim(),
    phone: formatBrokerPhone(digits),
    phoneDigits: digits,
  }
}

export function normalizeCustomsBroker(raw: unknown): CustomsBroker | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = String(o.id || '').trim()
  const name = String(o.name || '').trim()
  if (!id || !name) return null
  const contactsRaw = Array.isArray(o.contacts) ? o.contacts : []
  const seen = new Set<string>()
  const contacts: CustomsBrokerContact[] = []
  for (const c of contactsRaw) {
    const n = normalizeCustomsBrokerContact(c, id)
    if (!n) continue
    if (seen.has(n.phoneDigits)) continue
    seen.add(n.phoneDigits)
    contacts.push(n)
  }
  contacts.sort(
    (a, b) =>
      (a.name ? 0 : 1) - (b.name ? 0 : 1) ||
      a.name.localeCompare(b.name, 'he') ||
      a.phoneDigits.localeCompare(b.phoneDigits),
  )
  return { id, name, contacts }
}

export function normalizeCustomsBrokers(
  list: unknown,
  opts?: { seedIfEmpty?: boolean },
): CustomsBroker[] {
  const raw = Array.isArray(list) ? list : []
  const out: CustomsBroker[] = []
  const seenIds = new Set<string>()
  for (const item of raw) {
    const n = normalizeCustomsBroker(item)
    if (!n || seenIds.has(n.id)) continue
    seenIds.add(n.id)
    out.push(n)
  }
  if (out.length === 0 && opts?.seedIfEmpty !== false) {
    return seedCustomsBrokers()
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'he'))
  return out
}

export function customsBrokerMatchesQuery(
  broker: CustomsBroker,
  query: string,
): boolean {
  const q = normalizeHeSearch(query)
  if (!q) return true
  if (normalizeHeSearch(broker.name).includes(q)) return true
  const qDigits = digitsOnlyPhone(query)
  for (const c of broker.contacts) {
    if (c.name && normalizeHeSearch(c.name).includes(q)) return true
    if (qDigits.length >= 3 && c.phoneDigits.includes(qDigits)) return true
  }
  return false
}

export function filterCustomsBrokers(
  brokers: CustomsBroker[],
  query: string,
): CustomsBroker[] {
  return brokers.filter((b) => customsBrokerMatchesQuery(b, query))
}

export function brokerInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '#'
  const ch = trimmed[0]!
  if (/[א-ת]/.test(ch)) return ch
  if (/[A-Za-z]/.test(ch)) return ch.toUpperCase()
  return '#'
}

/** Full Hebrew alef-bet for directory index. */
export const HEBREW_ALPHABET = [
  'א',
  'ב',
  'ג',
  'ד',
  'ה',
  'ו',
  'ז',
  'ח',
  'ט',
  'י',
  'כ',
  'ל',
  'מ',
  'נ',
  'ס',
  'ע',
  'פ',
  'צ',
  'ק',
  'ר',
  'ש',
  'ת',
] as const

export function groupBrokersByInitial(
  brokers: CustomsBroker[],
): { initial: string; brokers: CustomsBroker[] }[] {
  const map = new Map<string, CustomsBroker[]>()
  for (const b of brokers) {
    const initial = brokerInitial(b.name)
    const list = map.get(initial) ?? []
    list.push(b)
    map.set(initial, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'he'))
    .map(([initial, list]) => ({
      initial,
      brokers: list
        .slice()
        .sort((x, y) => x.name.localeCompare(y.name, 'he')),
    }))
}
