import { v4 as uuid } from 'uuid'
import { DEFAULT_CERTIFICATIONS } from './constants'
import {
  defaultBriefingSeed,
  defaultQuestionSeed,
} from './lib/briefings'
import { seedCustomsBrokers } from './lib/customsBrokers'
import type { AppData, Lane, Worker } from './types'

/** Real gate roster — phones normalized without dashes */
export const WORKER_ROSTER: { fullName: string; phone: string; isManager?: boolean }[] = [
  { fullName: 'אביב חי טפלשוילי', phone: '0508676524' },
  { fullName: 'אבירן אברהם דסה', phone: '0539633063' },
  { fullName: 'אדיר דאי', phone: '0528885977' },
  { fullName: 'אוריה כהן', phone: '0536071196' },
  { fullName: 'אירנה גלפרין', phone: '0537273180' },
  { fullName: 'אליאן דדון', phone: '0524776343' },
  { fullName: 'דור בכור', phone: '0502384846' },
  { fullName: 'זיווה אלמדאי', phone: '0505250483' },
  { fullName: 'חיה מנגדיש', phone: '0506945567' },
  { fullName: 'לאון קולסניק', phone: '0542064272' },
  { fullName: 'לירז דרבה', phone: '0539277541' },
  { fullName: 'מעיין איילי', phone: '0539740744' },
  { fullName: 'מעיין באסטקאר', phone: '0534280149' },
  { fullName: 'נתנאל מאיר', phone: '0525651294' },
  { fullName: 'עדי אנגאו', phone: '0538916668' },
  { fullName: 'קורל שמואל', phone: '0549486021' },
  { fullName: 'קיריל ליטבק', phone: '0538658879' },
  { fullName: 'קריסטינה שקיראק', phone: '0526442431' },
  { fullName: 'רונית בכר', phone: '0535586417' },
  { fullName: "שחר צ'קול", phone: '0507433706' },
  { fullName: 'שי אלישע', phone: '0537171884', isManager: true },
  { fullName: 'שיראל טגבה', phone: '0533200457' },
]

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function isDefaultManager(w: { fullName: string; phone: string }): boolean {
  return w.fullName === 'שי אלישע' || normalizePhone(w.phone) === '0537171884'
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
    customsBrokers: seedCustomsBrokers(),
    revision: 0,
  }
}
