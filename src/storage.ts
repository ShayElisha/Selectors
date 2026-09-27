import { v4 as uuid } from 'uuid'
import { DEFAULT_CERTIFICATIONS } from './constants'
import {
  defaultBriefingSeed,
  defaultQuestionSeed,
} from './lib/briefings'
import type { AppData, Lane, Worker } from './types'

/** Real gate roster — phones normalized without dashes */
export const WORKER_ROSTER: { fullName: string; phone: string; isManager?: boolean }[] = [
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
  { fullName: "[REDACTED]", phone: '[REDACTED]' },
  { fullName: '[REDACTED]', phone: '[REDACTED]', isManager: true },
  { fullName: '[REDACTED]', phone: '[REDACTED]' },
]

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function isDefaultManager(w: { fullName: string; phone: string }): boolean {
  return w.fullName === '[REDACTED]' || normalizePhone(w.phone) === '[REDACTED]'
}

function seedWorkers(): Worker[] {
  return WORKER_ROSTER.map((w) => {
    const isManager = Boolean(w.isManager) || isDefaultManager(w)
    return {
      id: uuid(),
      fullName: w.fullName,
      phone: w.phone,
      email: '',
      certifications: [],
      status: 'active' as const,
      isInspector: !isManager,
      isManager,
    }
  })
}

function seedLanes(): Lane[] {
  return [
    {
      id: uuid(),
      name: 'נתיב 1',
      staffingStandard: 2,
      requiredCertifications: [],
      intensity: 'medium',
    },
    {
      id: uuid(),
      name: 'נתיב 2',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'hard',
    },
    {
      id: uuid(),
      name: 'נתיב מהיר',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'easy',
    },
    {
      id: uuid(),
      name: 'כבודה',
      staffingStandard: 2,
      requiredCertifications: [],
      intensity: 'hard',
    },
    {
      id: uuid(),
      name: 'מכס',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'medium',
      afternoonHandoff: true,
    },
    {
      id: uuid(),
      name: 'ראיונות',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'medium',
    },
    {
      id: uuid(),
      name: 'מנהל שער',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'medium',
    },
  ]
}

export function createSeedData(): AppData {
  return {
    workers: seedWorkers(),
    lanes: seedLanes(),
    history: [],
    certificationsCatalog: [...DEFAULT_CERTIFICATIONS],
    briefingSections: defaultBriefingSeed(),
    questionBank: defaultQuestionSeed(),
    customsBrokers: [],
    revision: 0,
  }
}
