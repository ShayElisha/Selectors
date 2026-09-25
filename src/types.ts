export type Intensity = 'easy' | 'medium' | 'hard'
export type WorkerStatus = 'active' | 'inactive'
export type ShiftType = 'morning' | 'afternoon' | 'night'
/** Per-lane / per-shift staffing תקן (max participants). */
export type StaffingStandard = 1 | 2 | 3 | 4 | 5

export interface Worker {
  id: string
  fullName: string
  phone: string
  /** Required when isManager — used for temp password / reset emails */
  email?: string
  certifications: string[]
  status: WorkerStatus
  /** Appears in assignment pools and analytics when active */
  isInspector: boolean
  /** Can log in to the system with phone + password */
  isManager: boolean
}

export interface Lane {
  id: string
  name: string
  staffingStandard: StaffingStandard
  /** Worker must hold all listed certifications */
  requiredCertifications: string[]
  intensity: Intensity
  /**
   * Afternoon handoff lane (e.g. מכס): prefer staff who arrive only for afternoon.
   * Long-shift continuers (morning→afternoon) are fallbacks only.
   */
  afternoonHandoff?: boolean
}

export interface LaneAssignment {
  laneId: string
  workerIds: string[]
  /** Free-text note for this lane on the shift (also shared to WhatsApp) */
  notes?: string
}

/** Inspector board (one placement for the shift) or selector rounds. */
export type ShiftAudience = 'inspector' | 'selector'

/**
 * One 2-hour route round on a selector shift.
 * Rows of the selector table; columns are lanes inside `assignments`.
 */
export interface SelectorRound {
  /** Minutes from local midnight; night rounds may pass 24:00. */
  startMinutes: number
  endMinutes: number
  /** e.g. 06:00–08:00 */
  label: string
  assignments: LaneAssignment[]
}

export interface ShiftSchedule {
  id: string
  date: string
  shiftType: ShiftType
  /**
   * Missing means inspector. Selector shifts rotate lanes every two hours
   * and can exist beside an inspector shift of the same date and type.
   */
  audience?: ShiftAudience
  activeLaneIds: string[]
  presentWorkerIds: string[]
  /**
   * Optional designated gate manager for this shift (מנהל שער).
   * Must be a present manager; auto-assigned to the מנהל שער station.
   */
  gateManagerWorkerId?: string
  assignments: LaneAssignment[]
  /** Selector board: time rounds × lanes. */
  rounds?: SelectorRound[]
  /**
   * Optional per-shift תקן overrides (1…5) keyed by lane id.
   * Must not exceed the lane catalog staffingStandard (max).
   * When absent, the shift default is 1.
   */
  staffingOverrides?: Record<string, StaffingStandard>
  createdAt: string
  updatedAt: string
}

export interface AppData {
  workers: Worker[]
  lanes: Lane[]
  history: ShiftSchedule[]
  /** Known certification labels used across the app */
  certificationsCatalog: string[]
  /** Shared briefing sections for worker תדריך (editable by managers) */
  briefingSections: BriefingSection[]
  /** Shared quiz bank for inspectors (editable by managers) */
  questionBank: InspectorQuestion[]
  /** Customs broker companies and contacts (editable directory) */
  customsBrokers: CustomsBroker[]
  /** Optimistic-lock revision from Mongo */
  revision?: number
}

/** A static briefing bullet/section managers maintain together. */
export interface BriefingSection {
  id: string
  title: string
  body: string
  order: number
  updatedAt: string
  updatedBy?: string
}

/** Open-ended question in the inspector question bank. */
export interface InspectorQuestion {
  id: string
  prompt: string
  /** Verbal / free-text answer */
  answer: string
  order: number
  updatedAt: string
  updatedBy?: string
}

/** Contact person / phone line for a customs broker company. */
export interface CustomsBrokerContact {
  id: string
  name: string
  phone: string
  phoneDigits: string
}

/** Customs brokerage company with dialable contacts. */
export interface CustomsBroker {
  id: string
  name: string
  contacts: CustomsBrokerContact[]
}

export type View =
  | 'home'
  | 'shift'
  | 'workers'
  | 'lanes'
  | 'history'
  | 'tracking'
  | 'analytics'
  | 'audit'
  | 'certs'
  | 'briefings'
  | 'customsBrokers'
