export type Intensity = 'easy' | 'medium' | 'hard'
export type WorkerStatus = 'active' | 'inactive' | 'archived'
export type ShiftType =
  | 'morning'
  | 'afternoonA'
  | 'afternoonB'
  | 'afternoon'
  | 'night'
/** Per-lane / per-shift staffing תקן (max participants). */
export type StaffingStandard = 1 | 2 | 3 | 4 | 5

export type StaffKind = 'inspector' | 'selector'

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
  /** Which side this person belongs to. Org managers can see both. */
  staffKind?: StaffKind
  /** Sees both modules and may appoint other organization managers. */
  isOrgManager?: boolean
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
  /**
   * Hours the lane is open, as minutes from midnight. Empty means always open.
   * Several ranges are allowed, e.g. 06:00–08:00 and 10:00–12:00.
   */
  activeHours?: { start: number; end: number }[]
}

export interface LaneAssignment {
  laneId: string
  workerIds: string[]
  /** Free-text note for this lane on the shift (also shared to WhatsApp) */
  notes?: string
}

/** Inspector board (one placement for the shift) or selector rounds. */
export type ShiftAudience = 'inspector' | 'selector'

/** How a section places people: rotating rounds, or one post for the whole shift. */
export type AssignmentMode = 'rounds' | 'single'

/**
 * One 2-hour route round on a selector shift.
 * Rows of the selector table; columns are lanes inside `assignments`.
 */
/** Which staggered grid a selector round belongs to. */
export type RoundCohort = 'hour' | 'half'

export interface SelectorRound {
  /** Minutes from local midnight; night rounds may pass 24:00. */
  startMinutes: number
  endMinutes: number
  /** e.g. 06:00–08:00 */
  label: string
  /** Set when the shift staggers rotations by half an hour. */
  cohort?: RoundCohort
  assignments: LaneAssignment[]
}

/** Time actually spent on one lane. Load uses this instead of a whole shift. */
export interface SeatSegment {
  workerId: string
  laneId: string
  fromMinutes: number
  toMinutes: number
}

export interface ShiftChangeMove {
  workerId: string
  fromLaneId: string | null
  toLaneId: string | null
}

/** One real-time refill recorded on the shift document. */
export interface ShiftChangeEvent {
  id: string
  at: string
  atMinutes: number
  removedWorkerId: string
  summary: string
  lines: string[]
  moves: ShiftChangeMove[]
}

/** One person left early or their shift was cancelled. */
export interface ShiftDrop {
  workerId: string
  kind: 'leave' | 'cancel' | 'noshow'
  /** Clock minutes. For a leave this is when they stepped down. */
  minutes: number
  reason: string
}

/** Formal close by the manager who is logged in. After this, the board is locked. */
export interface ShiftSignOff {
  signedAt: string
  signerName: string
  signerId: string
  /** Typed full name, matching the connected manager. */
  signature: string
}

/** A small trim of a person's saved hours. Does not rewrite the placement. */
export interface WindowAdjustment {
  /** Arrived this many minutes later than the saved window. */
  lateMinutes?: number
  /** Left this many minutes earlier than the saved window. */
  earlyMinutes?: number
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
  /**
   * Missing on older shifts: selectors used rounds, inspectors used one placement.
   * New shifts copy the organization setting so later setting changes do not rewrite history.
   */
  assignmentMode?: AssignmentMode
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
  /**
   * Personal hours for present workers (window preset id).
   * Missing means the person covers the whole main shift.
   */
  workerWindows?: Record<string, string>
  /**
   * Late arrival or early leave, in minutes, without moving the saved placement.
   * The next automatic assignment uses the trimmed window.
   */
  windowAdjustments?: Record<string, WindowAdjustment>
  /** When true, selector rounds alternate between the hour and the half-hour. */
  staggerRounds?: boolean
  /**
   * Why each person was placed, saved with the shift.
   * Older shifts may omit this; the history screen can rebuild it.
   */
  explanations?: { laneId: string; workerId: string; reasons: string[] }[]
  /**
   * Present only after an explicit shift close.
   * The board cannot be edited or deleted once this is stored.
   */
  signOff?: ShiftSignOff
  /** True after a manager accepted an automatic refill. */
  isSelfHealed?: boolean
  /** Minutes actually sat, when someone left or joined mid-shift. */
  seatSegments?: SeatSegment[]
  /** The full shift clock the segments are measured against. */
  seatSpan?: { startMinutes: number; endMinutes: number }
  /** Easy lanes left empty because nobody could cover a harder lane. */
  frozenLaneIds?: string[]
  /** Real-time board changes, newest last. */
  shiftEvents?: ShiftChangeEvent[]
  /** Clock time someone left the shift, keyed by worker id. Load uses the hours until then. */
  earlyLeaveAt?: Record<string, number>
  /** Early leaves and cancellations, with the reason the manager wrote. */
  shiftDrops?: ShiftDrop[]
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
  /** Shift windows for this module. Empty means the built-in defaults. */
  shiftModels?: ShiftModel[]
  /** Optimistic-lock revision from Mongo */
  revision?: number
}

/** A static briefing bullet/section managers maintain together. */
export interface BriefingSection {
  id: string
  title: string
  body: string
  order: number
  /** When set, the section stays at the top of the briefing list. */
  starred?: boolean
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

/** Named shift window stored separately for selectors and for inspectors. */
export interface ShiftModel {
  id: string
  name: string
  startMinutes: number
  endMinutes: number
  order: number
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
  | 'shiftModels'
  | 'customsBrokers'
  | 'settings'
