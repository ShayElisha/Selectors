import { randomUUID } from "node:crypto";
import {
  getAuditCollection,
  getDb,
  getMetaCollection,
  getStateCollection,
  operationalDbTargets,
  withDbTransaction,
} from "./db.js";
import {
  appendAuditLog,
  diffAppDataAuditEvents,
  shiftAuditHeader,
  summarizeAssignmentChanges,
} from "./audit.js";
import { validateSelfHeal } from "./selfHeal.js";
import { sendTempPasswordEmail } from "./mail.js";
import { generateTempPassword, hashPassword } from "./password.js";
import {
  authenticateManager,
  createLegacyOrganization,
  disableWorkerAccount,
  requestAccountPasswordReset,
  upsertManagerAccount,
} from "./orgs.js";

export function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function isValidEmail(email) {
  const e = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function createSeedData() {
  return {
    workers: [],
    lanes: [],
    history: [],
    certificationsCatalog: [],
    briefingSections: [],
    questionBank: [],
    customsBrokers: [],
    incidents: [],
    shiftModels: [],
  };
}

function uniqueLabels(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const label = String(value || "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

function normalizeWorker(w, fallbackKind = "selector") {
  const isManager = Boolean(w.isManager);
  const hasInspectorFlag = Object.prototype.hasOwnProperty.call(
    w,
    "isInspector",
  );
  let isInspector = hasInspectorFlag ? Boolean(w.isInspector) : !isManager;
  if (!isInspector && !isManager) isInspector = true;
  const staffKind =
    w.staffKind === "inspector" ||
    w.staffKind === "selector" ||
    w.staffKind === "security"
      ? w.staffKind
      : fallbackKind;
  const isOrgManager = Boolean(w.isOrgManager);
  const canLogin = Boolean(w.canLogin) || isManager || isOrgManager;
  const worker = {
    id: w.id,
    fullName: w.fullName || "",
    phone: w.phone || "",
    email: normalizeEmail(w.email),
    certifications: uniqueLabels(w.certifications),
    status:
      w.status === "inactive" || w.status === "archived" ? w.status : "active",
    isInspector,
    isManager: isManager || isOrgManager,
    staffKind,
    isOrgManager,
    canLogin,
    managerNotes: String(w.managerNotes || "").trim().slice(0, 2000),
  };
  if (typeof w.passwordHash === "string" && w.passwordHash) {
    worker.passwordHash = w.passwordHash;
  }
  if ("mustChangePassword" in w) {
    worker.mustChangePassword = Boolean(w.mustChangePassword);
  }
  return worker;
}

function normalizeShiftModels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const id = String(item.id || "").trim();
      const name = String(item.name || "").trim();
      const startMinutes = Number(item.startMinutes);
      const endMinutes = Number(item.endMinutes);
      if (!id || !name) return null;
      if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes))
        return null;
      return {
        id,
        name,
        startMinutes: Math.max(0, Math.round(startMinutes)),
        endMinutes: Math.max(0, Math.round(endMinutes)),
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
}

function normalizeLane(l) {
  const std = Number(l?.staffingStandard);
  const staffingStandard =
    Number.isInteger(std) && std >= 1 && std <= 5 ? std : 1;
  return {
    id: l.id,
    name: l.name || "",
    staffingStandard,
    requiredCertifications: uniqueLabels(l.requiredCertifications),
    intensity:
      l.intensity === "easy" ||
      l.intensity === "hard" ||
      l.intensity === "medium"
        ? l.intensity
        : "medium",
    afternoonHandoff: Boolean(l.afternoonHandoff),
    roundsDisabled: Boolean(l.roundsDisabled),
    ...(Array.isArray(l.activeHours) && l.activeHours.length > 0
      ? {
          activeHours: l.activeHours
            .map((h) => ({
              start: Math.trunc(Number(h?.start)),
              end: Math.trunc(Number(h?.end)),
            }))
            .filter(
              (h) =>
                Number.isFinite(h.start) &&
                Number.isFinite(h.end) &&
                h.start >= 0 &&
                h.end <= 36 * 60 &&
                h.end > h.start,
            ),
        }
      : {}),
  };
}

function normalizeCustomsBrokerContact(c, brokerId) {
  if (!c || typeof c !== "object") return null;
  let digits = String(c.phoneDigits || c.phone || "").replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("5")) digits = `0${digits}`;
  if (digits.length === 8 && /^[23489]/.test(digits)) digits = `0${digits}`;
  if (digits.length < 9 || digits.length > 10 || !digits.startsWith("0")) {
    return null;
  }
  const id = String(c.id || "").trim() || `${brokerId}-${digits}`;
  let phone = String(c.phone || "").trim();
  if (!phone) {
    phone =
      digits.length === 10
        ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
        : `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  return {
    id,
    name: String(c.name || "").trim(),
    phone,
    phoneDigits: digits,
  };
}

function normalizeCustomsBrokersList(list) {
  const raw = Array.isArray(list) ? list : [];
  if (raw.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    const name = String(item.name || "").trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const contacts = [];
    const phoneSeen = new Set();
    for (const c of Array.isArray(item.contacts) ? item.contacts : []) {
      const n = normalizeCustomsBrokerContact(c, id);
      if (!n || phoneSeen.has(n.phoneDigits)) continue;
      phoneSeen.add(n.phoneDigits);
      contacts.push(n);
    }
    out.push({ id, name, contacts });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "he"));
  return out;
}

export function normalizeData(raw, fallbackKind = "selector") {
  const kind =
    fallbackKind === "inspector" || fallbackKind === "security"
      ? fallbackKind
      : "selector";
  const briefingSections = Array.isArray(raw?.briefingSections)
    ? raw.briefingSections
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const id = String(s.id || "").trim();
          const title = String(s.title || "").trim();
          if (!id || !title) return null;
          const order = Number(s.order);
          return {
            id,
            title,
            body: String(s.body || "").trim(),
            order: Number.isFinite(order) ? order : 0,
            updatedAt: String(s.updatedAt || new Date().toISOString()),
            ...(typeof s.updatedBy === "string" && s.updatedBy.trim()
              ? { updatedBy: s.updatedBy.trim() }
              : {}),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
    : [];

  const questionBank = Array.isArray(raw?.questionBank)
    ? raw.questionBank
        .map((q) => {
          if (!q || typeof q !== "object") return null;
          const id = String(q.id || "").trim();
          const prompt = String(q.prompt || "").trim();
          let answer = String(q.answer || "").trim();
          if (!answer) {
            const options = Array.isArray(q.options)
              ? q.options.map((x) => String(x ?? "").trim()).filter(Boolean)
              : [];
            if (options.length > 0) {
              let correctIndex = Math.trunc(Number(q.correctIndex));
              if (!Number.isFinite(correctIndex) || correctIndex < 0) {
                correctIndex = 0;
              }
              if (correctIndex >= options.length) correctIndex = 0;
              const picked = options[correctIndex] || "";
              const explanation = String(q.explanation || "").trim();
              answer = explanation ? `${picked} — ${explanation}` : picked;
            } else {
              answer = String(q.explanation || "").trim();
            }
          }
          if (!id || !prompt || !answer) return null;
          const order = Number(q.order);
          return {
            id,
            prompt,
            answer,
            order: Number.isFinite(order) ? order : 0,
            updatedAt: String(q.updatedAt || new Date().toISOString()),
            ...(typeof q.updatedBy === "string" && q.updatedBy.trim()
              ? { updatedBy: q.updatedBy.trim() }
              : {}),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
    : [];

  const validIncidentSeverities = new Set(['low', 'medium', 'high', 'critical']);
  const validIncidentStatuses = new Set([
    'pending_approval',
    'rejected',
    'open',
    'in_progress',
    'resolved',
  ]);
  const incidents = Array.isArray(raw?.incidents)
    ? raw.incidents
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const id = String(item.id || '').trim();
          const title = String(item.title || '').trim();
          const description = String(item.description || '').trim();
          if (!id || !title || !description) return null;
          const now = new Date().toISOString();
          return {
            id,
            kind:
              item.kind === 'fault' || item.kind === 'event'
                ? item.kind
                : /תקלה|תקלת|תקלות|כשל|כישלון|לא עובד|אינו עובד|לא פועל|אינו פועל|לא נפתח|לא נסגר|נשבר|שבור|קלקול|פגום|דליפה|נזילה|תקוע|תקיעה|קצר חשמלי|אין מתח|ציוד תקול/.test(
                    `${title} ${description}`,
                  )
                  ? 'fault'
                  : 'event',
            title,
            description,
            severity: validIncidentSeverities.has(item.severity)
              ? item.severity
              : 'medium',
            status: validIncidentStatuses.has(item.status)
              ? item.status
              : 'open',
            ...(typeof item.laneId === 'string' && item.laneId.trim()
              ? { laneId: item.laneId.trim() }
              : {}),
            ...(typeof item.shiftDate === 'string' && item.shiftDate.trim()
              ? { shiftDate: item.shiftDate.trim() }
              : {}),
            ...(typeof item.shiftType === 'string'
              ? { shiftType: item.shiftType }
              : {}),
            ...(typeof item.handlingNotes === 'string' && item.handlingNotes.trim()
              ? { handlingNotes: item.handlingNotes.trim() }
              : {}),
            ...(typeof item.reportedByWorkerId === 'string' &&
            item.reportedByWorkerId.trim()
              ? { reportedByWorkerId: item.reportedByWorkerId.trim() }
              : {}),
            ...(typeof item.reportedByName === 'string' && item.reportedByName.trim()
              ? { reportedByName: item.reportedByName.trim() }
              : {}),
            ...(typeof item.approvedBy === 'string' && item.approvedBy.trim()
              ? { approvedBy: item.approvedBy.trim() }
              : {}),
            ...(typeof item.approvedAt === 'string' && item.approvedAt.trim()
              ? { approvedAt: item.approvedAt.trim() }
              : {}),
            ...(typeof item.rejectedBy === 'string' && item.rejectedBy.trim()
              ? { rejectedBy: item.rejectedBy.trim() }
              : {}),
            ...(typeof item.rejectedAt === 'string' && item.rejectedAt.trim()
              ? { rejectedAt: item.rejectedAt.trim() }
              : {}),
            ...(typeof item.rejectionReason === 'string' &&
            item.rejectionReason.trim()
              ? { rejectionReason: item.rejectionReason.trim() }
              : {}),
            createdAt: String(item.createdAt || now),
            createdBy: String(item.createdBy || 'מנהל'),
            updatedAt: String(item.updatedAt || item.createdAt || now),
            updatedBy: String(item.updatedBy || item.createdBy || 'מנהל'),
          };
        })
        .filter(Boolean)
    : [];

  const lanes = Array.isArray(raw?.lanes) ? raw.lanes.map(normalizeLane) : [];
  const gateIdx = lanes.findIndex(
    (l) => String(l.name || "").trim() === "מנהל שער",
  );
  if (gateIdx < 0) {
    lanes.push({
      id: randomUUID(),
      name: "מנהל שער",
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: "medium",
      afternoonHandoff: false,
    });
  } else {
    const gate = lanes[gateIdx];
    lanes[gateIdx] = {
      ...gate,
      name: "מנהל שער",
      staffingStandard: 1,
      intensity: "medium",
    };
  }

  return {
    workers: Array.isArray(raw?.workers)
      ? raw.workers.map((worker) => normalizeWorker(worker, kind))
      : [],
    lanes,
    history: Array.isArray(raw?.history) ? raw.history : [],
    certificationsCatalog: Array.isArray(raw?.certificationsCatalog)
      ? uniqueLabels(raw.certificationsCatalog)
      : [],
    briefingSections,
    questionBank,
    incidents,
    customsBrokers: normalizeCustomsBrokersList(raw?.customsBrokers),
    shiftModels: normalizeShiftModels(raw?.shiftModels),
    revision: Number.isFinite(Number(raw?.revision)) ? Number(raw.revision) : 0,
  };
}

/** Strip secrets before sending AppData to clients. */
export function publicData(data) {
  if (!data) return data;
  return {
    ...data,
    workers: Array.isArray(data.workers)
      ? data.workers.map(
          ({ passwordHash: _h, mustChangePassword: _m, ...w }) => w,
        )
      : [],
  };
}

function mergeWorkerSecrets(incomingWorkers, prevWorkers) {
  const prevById = new Map((prevWorkers || []).map((w) => [w.id, w]));
  return incomingWorkers.map((w) => {
    const prev = prevById.get(w.id);
    const next = { ...w };
    if (!next.passwordHash && prev?.passwordHash) {
      next.passwordHash = prev.passwordHash;
    }
    if ("mustChangePassword" in w) {
      if (w.mustChangePassword && (next.isManager || next.canLogin)) {
        next.mustChangePassword = true;
      } else {
        delete next.mustChangePassword;
      }
    } else if (
      prev?.mustChangePassword &&
      (next.isManager || next.canLogin)
    ) {
      next.mustChangePassword = true;
    }
    if (!next.isManager && !next.canLogin) {
      delete next.mustChangePassword;
    }
    return next;
  });
}

function assertOrgManagerEdits(nextWorkers, prevWorkers, actor) {
  if (actor?.isOrgManager || actor?.role === "super_admin") return;
  const prevById = new Map(
    (prevWorkers || []).map((worker) => [worker.id, worker]),
  );
  for (const worker of nextWorkers) {
    const prev = prevById.get(worker.id);
    if (Boolean(prev?.isOrgManager) !== Boolean(worker.isOrgManager)) {
      const err = new Error("רק מנהל ארגון יכול למנות או להסיר מנהל ארגון");
      err.status = 403;
      throw err;
    }
  }
}

function accountRoleForWorker(worker) {
  if (worker.isManager || worker.isOrgManager) return "org_manager";
  if (worker.canLogin) return "worker";
  return null;
}

/**
 * Shared login accounts store isOrgManager once for all modules.
 * Promote when this module marks the worker as org manager; demote only when
 * THIS module's previous row had the flag and the new row clears it; otherwise
 * leave the account flag untouched (other modules may still hold it).
 * @returns {boolean|undefined}
 */
function nextOrgManagerFlag(worker, prev) {
  if (worker?.isOrgManager) return true;
  if (prev?.isOrgManager) return false;
  return undefined;
}

function moduleLabelHe(module) {
  if (module === "inspectors") return "בודקים";
  if (module === "security") return "מאבטחים";
  return "סלקטורים";
}

/**
 * Phone and email must be unique per organization across every module DB.
 * Empty emails are ignored; phones are compared as digits only.
 */
export async function assertUniqueWorkerContacts(workers, scope) {
  if (!scope?.orgId || !scope?.module) return;

  const phoneOwners = new Map();
  const emailOwners = new Map();

  for (const worker of workers || []) {
    const phone = normalizePhone(worker?.phone);
    if (phone) {
      const prev = phoneOwners.get(phone);
      if (prev && prev.id !== worker.id) {
        const err = new Error(
          `מספר הטלפון כבר בשימוש אצל ${prev.fullName || "עובד אחר"} במודול ${moduleLabelHe(scope.module)}. לא ניתן לשמור כפילות.`,
        );
        err.status = 409;
        throw err;
      }
      phoneOwners.set(phone, {
        id: worker.id,
        fullName: worker.fullName || "",
      });
    }

    const email = normalizeEmail(worker?.email);
    if (email && isValidEmail(email)) {
      const prev = emailOwners.get(email);
      if (prev && prev.id !== worker.id) {
        const err = new Error(
          `כתובת המייל כבר בשימוש אצל ${prev.fullName || "עובד אחר"} במודול ${moduleLabelHe(scope.module)}. לא ניתן לשמור כפילות.`,
        );
        err.status = 409;
        throw err;
      }
      emailOwners.set(email, {
        id: worker.id,
        fullName: worker.fullName || "",
      });
    }
  }

  if (phoneOwners.size === 0 && emailOwners.size === 0) return;

  for (const target of operationalDbTargets()) {
    if (target === scope.module) continue;
    let docs = [];
    try {
      const db = await getDb(target);
      docs = await db
        .collection("workers")
        .find(
          { orgId: String(scope.orgId) },
          { projection: { phone: 1, email: 1, fullName: 1, id: 1 } },
        )
        .toArray();
    } catch (err) {
      console.error(
        `[data] cross-module contact check failed for ${target}:`,
        err?.message || err,
      );
      continue;
    }
    const otherLabel = moduleLabelHe(target);
    for (const other of docs) {
      const phone = normalizePhone(other.phone);
      if (phone && phoneOwners.has(phone)) {
        const local = phoneOwners.get(phone);
        const err = new Error(
          `מספר הטלפון של ${local.fullName || "העובד"} כבר קיים במודול ${otherLabel} (${other.fullName || "עובד אחר"}). טלפון חייב להיות ייחודי בכל המודולים.`,
        );
        err.status = 409;
        throw err;
      }
      const email = normalizeEmail(other.email);
      if (email && isValidEmail(email) && emailOwners.has(email)) {
        const local = emailOwners.get(email);
        const err = new Error(
          `כתובת המייל של ${local.fullName || "העובד"} כבר קיימת במודול ${otherLabel} (${other.fullName || "עובד אחר"}). מייל חייב להיות ייחודי בכל המודולים.`,
        );
        err.status = 409;
        throw err;
      }
    }
  }
}

async function syncManagerAccess(workers, orgId, prevWorkers = []) {
  if (!orgId) return;
  const prevById = new Map((prevWorkers || []).map((w) => [w.id, w]));
  for (const worker of workers) {
    const role = accountRoleForWorker(worker);
    if (!role || !worker.phone) continue;
    const prev = prevById.get(worker.id);
    const isOrgManager = nextOrgManagerFlag(worker, prev);
    await upsertManagerAccount({
      orgId,
      workerId: worker.id,
      fullName: worker.fullName,
      phone: worker.phone,
      email: worker.email,
      staffKind:
        worker.staffKind === "inspector" ||
        worker.staffKind === "selector" ||
        worker.staffKind === "security"
          ? worker.staffKind
          : "selector",
      ...(typeof isOrgManager === "boolean" ? { isOrgManager } : {}),
      role,
    });
  }
}

function assertManagersHaveEmail(workers, prevWorkers) {
  const prevById = new Map((prevWorkers || []).map((w) => [w.id, w]));
  for (const w of workers) {
    const needsLogin = Boolean(w.isManager || w.isOrgManager || w.canLogin);
    if (!needsLogin) continue;
    if (isValidEmail(w.email)) continue;
    const prev = prevById.get(w.id);
    const newlyLogin =
      !prev ||
      (!prev.isManager && w.isManager) ||
      (!prev.isOrgManager && w.isOrgManager) ||
      (!prev.canLogin && w.canLogin);
    // Org managers / shift managers must keep a valid email for MFA login.
    if (newlyLogin || w.isOrgManager || w.isManager) {
      const err = new Error(
        `לא ניתן לשמור מנהל ללא מייל תקין (${w.fullName || "ללא שם"})`,
      );
      err.status = 400;
      throw err;
    }
  }
}

function workerHadLogin(prev) {
  return Boolean(prev?.isManager || prev?.canLogin);
}

function workerHasLogin(worker) {
  return Boolean(worker.isManager || worker.canLogin);
}

function shouldIssueTempPassword(worker, prev) {
  if (!workerHasLogin(worker)) return false;
  if (!isValidEmail(worker.email)) return false;
  if (!prev) return true;
  if (!workerHadLogin(prev)) return true;
  if (!prev.passwordHash) return true;
  return false;
}

/**
 * Issue temp passwords + emails for new/promoted managers.
 * @returns {Promise<{ workers: object[], mailErrors: string[] }>}
 */
async function applyManagerInvites(workers, prevWorkers, options = {}) {
  if (options.skipManagerInvites) {
    return { workers, mailErrors: [] };
  }
  const prevById = new Map((prevWorkers || []).map((w) => [w.id, w]));
  const mailErrors = [];
  const nextWorkers = [];

  for (const w of workers) {
    const prev = prevById.get(w.id);
    if (
      options.scope?.orgId &&
      workerHadLogin(prev) &&
      !workerHasLogin(w)
    ) {
      await disableWorkerAccount(options.scope.orgId, w.id);
    }
    if (!shouldIssueTempPassword(w, prev)) {
      nextWorkers.push(w);
      continue;
    }
    const tempPassword = generateTempPassword();
    try {
      await sendTempPasswordEmail({
        to: w.email,
        fullName: w.fullName,
        tempPassword,
        reason: "invite",
      });
    } catch (e) {
      mailErrors.push(
        `${w.fullName}: ${e instanceof Error ? e.message : "שליחת מייל נכשלה"}`,
      );
      nextWorkers.push(w);
      continue;
    }
    const passwordHash = await hashPassword(tempPassword);
    const invited = {
      ...w,
      passwordHash,
      mustChangePassword: true,
    };
    if (options.scope?.orgId) {
      const isOrgManager = nextOrgManagerFlag(w, prev);
      await upsertManagerAccount({
        orgId: options.scope.orgId,
        workerId: w.id,
        fullName: w.fullName,
        phone: w.phone,
        email: w.email,
        passwordHash,
        mustChangePassword: true,
        staffKind: w.staffKind,
        ...(typeof isOrgManager === "boolean" ? { isOrgManager } : {}),
        role: accountRoleForWorker(w),
      });
    }
    nextWorkers.push(invited);
    await appendAuditLog({
      action: "manager_invite",
      actor: options.actor || null,
      orgId: options.scope?.orgId,
      module: options.scope?.module,
      details: `סיסמה זמנית נשלחה אל ${w.fullName} (${w.email})`,
    });
  }

  if (mailErrors.length > 0) {
    const err = new Error(
      `שליחת מייל למנהל נכשלה — השינויים לא נשמרו: ${mailErrors.join(" · ")}`,
    );
    err.status = 502;
    throw err;
  }

  return { workers: nextWorkers, mailErrors };
}

const MODEL_COLLECTIONS = {
  workers: "workers",
  lanes: "lanes",
  shifts: "shifts",
  certifications: "certifications",
  briefingSections: "briefing_sections",
  questionBank: "questions",
  customsBrokers: "customs_brokers",
  shiftModels: "shift_models",
  incidents: "incidents",
};

const SHIFT_VERSIONS_COLLECTION = "shift_versions";
const SHIFT_HANDOFF_COLLECTION = "shift_handoff_notes";

function orderedDocs(items) {
  return items.map((item, listOrder) => {
    const id = item?.id || randomUUID();
    return { ...item, id, _id: id, listOrder };
  });
}

function fromOrderedDocs(docs) {
  return [...docs]
    .sort((a, b) => (a.listOrder ?? 0) - (b.listOrder ?? 0))
    .map(
      ({
        _id: _ignored,
        listOrder: _order,
        orgId: _org,
        module: _module,
        ...item
      }) => item,
    );
}

function scopeFilter(scope) {
  if (!scope) return { orgId: { $exists: false } };
  return { orgId: scope.orgId, module: scope.module };
}

function metaIdFor(scope) {
  return scope ? `${scope.orgId}:${scope.module}` : "main";
}

function stampScope(doc, scope) {
  if (!scope) return doc;
  const next = { ...doc, orgId: scope.orgId, module: scope.module };
  if (doc.id) next._id = `${scope.orgId}:${scope.module}:${doc.id}`;
  return next;
}

/** Keep the first document for every _id (a duplicate _id makes insertMany fail with E11000). */
function dedupeById(docs) {
  const map = new Map();
  for (const d of docs) {
    if (!map.has(d._id)) map.set(d._id, d);
  }
  return [...map.values()];
}

async function loadModelDocs(db, name, session, scope) {
  const query = db
    .collection(name)
    .find(scopeFilter(scope), session ? { session } : {});
  return query.toArray();
}

async function loadCompleteHistory(scope, historyRevision, target) {
  const key = stateCacheKey(scope);
  const cached = historyCache.get(key);
  if (cached?.revision === Number(historyRevision)) return cached.promise;

  const promise = (async () => {
    const items = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await listHistoryPage(scope, { limit: 60, offset });
      items.push(...page.items);
      total = page.total;
      offset += page.items.length;
    } while (offset < total);
    return items;
  })();
  historyCache.set(key, { revision: Number(historyRevision), promise });
  try {
    return await promise;
  } catch (error) {
    if (historyCache.get(key)?.promise === promise) historyCache.delete(key);
    throw error;
  }
}

async function assembleState(
  revision,
  session,
  scope,
  target = "selectors",
  historyRevision = revision,
) {
  const db = await getDb(target);
  const read = (name) => loadModelDocs(db, name, session, scope);
  const [
    workers,
    lanes,
    certifications,
    briefingSections,
    questionBank,
    customsBrokers,
    shiftModels,
    incidents,
  ] = await Promise.all([
    read(MODEL_COLLECTIONS.workers),
    read(MODEL_COLLECTIONS.lanes),
    read(MODEL_COLLECTIONS.certifications),
    read(MODEL_COLLECTIONS.briefingSections),
    read(MODEL_COLLECTIONS.questionBank),
    read(MODEL_COLLECTIONS.customsBrokers),
    read(MODEL_COLLECTIONS.shiftModels),
    read(MODEL_COLLECTIONS.incidents),
  ]);
  const history = scope?.orgId
    ? await loadCompleteHistory(scope, historyRevision, target)
    : await read(MODEL_COLLECTIONS.shifts);
  return normalizeData(
    {
      workers: fromOrderedDocs(workers),
      lanes: fromOrderedDocs(lanes),
      history: fromOrderedDocs(history),
      certificationsCatalog: fromOrderedDocs(certifications).map(
        (item) => item.name,
      ),
      briefingSections: fromOrderedDocs(briefingSections),
      questionBank: fromOrderedDocs(questionBank),
      customsBrokers: fromOrderedDocs(customsBrokers),
      shiftModels: fromOrderedDocs(shiftModels),
      incidents: fromOrderedDocs(incidents),
      revision: Number.isFinite(Number(revision)) ? Number(revision) : 0,
    },
    scope?.module === "inspectors"
      ? "inspector"
      : scope?.module === "security"
        ? "security"
        : "selector",
  );
}

/**
 * Idempotent write: upsert every document and delete only the ones that
 * disappeared. No deleteMany + insertMany window, and duplicate ids are
 * collapsed, so a repeated id or a concurrent upsertShift cannot cause E11000.
 */
async function replaceModels(
  snapshot,
  revision,
  session,
  scope = null,
  target = "selectors",
  historyRevision = revision,
  writeHistory = true,
) {
  const db = await getDb(target);
  const certPrefix = scope ? `${scope.orgId}:${scope.module}:cert` : "cert";
  const models = [
    [
      MODEL_COLLECTIONS.workers,
      orderedDocs(snapshot.workers || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.lanes,
      orderedDocs(snapshot.lanes || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.shifts,
      orderedDocs(snapshot.history || []).map((doc) => stampScope(doc, scope)),
    ],
    [
      MODEL_COLLECTIONS.certifications,
      (snapshot.certificationsCatalog || []).map((name, listOrder) =>
        stampScope(
          {
            _id: `${certPrefix}:${listOrder}`,
            name: String(name),
            listOrder,
          },
          scope,
        ),
      ),
    ],
    [
      MODEL_COLLECTIONS.briefingSections,
      orderedDocs(snapshot.briefingSections || []).map((doc) =>
        stampScope(doc, scope),
      ),
    ],
    [
      MODEL_COLLECTIONS.questionBank,
      orderedDocs(snapshot.questionBank || []).map((doc) =>
        stampScope(doc, scope),
      ),
    ],
    [
      MODEL_COLLECTIONS.customsBrokers,
      orderedDocs(snapshot.customsBrokers || []).map((doc) =>
        stampScope(doc, scope),
      ),
    ],
    [
      MODEL_COLLECTIONS.shiftModels,
      orderedDocs(snapshot.shiftModels || []).map((doc) =>
        stampScope(doc, scope),
      ),
    ],
    [
      MODEL_COLLECTIONS.incidents,
      orderedDocs(snapshot.incidents || []).map((doc) =>
        stampScope(doc, scope),
      ),
    ],
  ];
  const opts = session ? { session } : {};
  for (const [name, rawDocs] of models) {
    if (name === MODEL_COLLECTIONS.shifts && !writeHistory) continue;
    const col = db.collection(name);
    const docs = dedupeById(rawDocs);
    const ids = docs.map((d) => d._id);

    // Remove only documents that are no longer part of the snapshot.
    await col.deleteMany({ ...scopeFilter(scope), _id: { $nin: ids } }, opts);

    if (docs.length > 0) {
      await col.bulkWrite(
        docs.map(({ _id, ...doc }) => ({
          replaceOne: { filter: { _id }, replacement: doc, upsert: true },
        })),
        { ordered: false, ...opts },
      );
    }
  }
  const meta = await getMetaCollection(target);
  await meta.updateOne(
    { _id: metaIdFor(scope) },
    {
      $set: {
        schema: "collections",
        revision,
        historyRevision,
        updatedAt: new Date(),
      },
    },
    { upsert: true, ...opts },
  );
}

async function migrateLegacyState(session, target = "selectors") {
  const metaCol = await getMetaCollection(target);
  const opts = session ? { session } : {};
  const meta = await metaCol.findOne({ _id: "main" }, opts);
  if (meta?.schema === "collections") {
    return assembleState(meta.revision, session, null, target);
  }

  const legacyCol = await getStateCollection(target);
  const legacy = await legacyCol.findOne({ _id: "main" }, opts);
  const source = legacy
    ? normalizeData(legacy)
    : normalizeData(createSeedData());
  const revision = legacy
    ? Number.isFinite(Number(legacy.revision))
      ? Number(legacy.revision)
      : 1
    : 1;
  await replaceModels(
    {
      workers: source.workers,
      lanes: source.lanes,
      history: source.history,
      certificationsCatalog: source.certificationsCatalog,
      briefingSections: source.briefingSections,
      questionBank: source.questionBank,
      customsBrokers: source.customsBrokers,
      incidents: source.incidents,
    },
    revision,
    session,
    null,
    target,
  );
  if (legacy) {
    await legacyCol.updateOne(
      { _id: "main" },
      { $set: { archivedAt: new Date(), supersededBy: "collections" } },
      opts,
    );
  }
  return { ...source, revision };
}

let tenancyMigration = null;

function snapshotOf(source) {
  return {
    workers: source.workers,
    lanes: source.lanes,
    history: source.history,
    certificationsCatalog: source.certificationsCatalog,
    briefingSections: source.briefingSections,
    questionBank: source.questionBank,
    customsBrokers: source.customsBrokers,
    shiftModels: source.shiftModels,
    incidents: source.incidents,
  };
}

async function hasStoredOperationalData(target = "selectors") {
  const db = await getDb(target);
  for (const name of Object.values(MODEL_COLLECTIONS)) {
    const count = await db
      .collection(name)
      .countDocuments({ orgId: { $exists: false } });
    if (count > 0) return true;
  }
  const legacyCol = await getStateCollection(target);
  const legacy = await legacyCol.findOne({ _id: "main" });
  if (!legacy || legacy.archivedAt || legacy.supersededBy === "tenancy")
    return false;
  return Boolean(
    (Array.isArray(legacy.workers) && legacy.workers.length) ||
    (Array.isArray(legacy.lanes) && legacy.lanes.length) ||
    (Array.isArray(legacy.history) && legacy.history.length),
  );
}

/** Move the previous single-body database into one approved organization. */
export async function migrateLegacyTenancy() {
  if (!tenancyMigration) {
    tenancyMigration = runLegacyTenancyMigration().catch((err) => {
      tenancyMigration = null;
      throw err;
    });
  }
  return tenancyMigration;
}

async function runLegacyTenancyMigration() {
  const metaCol = await getMetaCollection();
  const done = await metaCol.findOne({ _id: "tenancy-v1" });
  if (done?.done) return;

  const exists = await hasStoredOperationalData();
  if (exists) {
    const meta = await metaCol.findOne({ _id: "main" });
    let source;
    if (meta?.schema === "collections") {
      source = await assembleState(meta.revision, undefined, null);
    } else {
      source = await migrateLegacyState();
    }
    const hasRows =
      source.workers.length > 0 ||
      source.lanes.length > 0 ||
      source.history.length > 0;
    if (hasRows) {
      const orgId = await createLegacyOrganization(source.workers);
      const revision = source.revision || 1;
      await replaceModels(
        { ...snapshotOf(source), history: source.history },
        revision,
        undefined,
        { orgId, module: "selectors" },
      );
      await replaceModels(
        { ...snapshotOf(source), history: [] },
        revision,
        undefined,
        { orgId, module: "inspectors" },
      );
      const db = await getDb();
      for (const name of Object.values(MODEL_COLLECTIONS)) {
        await db.collection(name).deleteMany({ orgId: { $exists: false } });
      }
    }
  }

  await metaCol.updateOne(
    { _id: "tenancy-v1" },
    { $set: { done: true, at: new Date() } },
    { upsert: true },
  );
}

function emptyState() {
  return normalizeData({
    workers: [],
    lanes: [],
    history: [],
    certificationsCatalog: [],
    briefingSections: [],
    questionBank: [],
    customsBrokers: [],
    shiftModels: [],
    incidents: [],
    revision: 0,
  });
}

function targetForScope(scope) {
  if (scope?.module === "inspectors") return "inspectors";
  if (scope?.module === "security") return "security";
  return "selectors";
}

let inspectorsMigration = null;

/** Attach the existing inspectors database to the original organization. */
export async function migrateInspectorsDatabase() {
  if (!process.env.MONGODB_URI_INSPECTORS?.trim()) return;
  if (!inspectorsMigration) {
    inspectorsMigration = runInspectorsMigration().catch((err) => {
      inspectorsMigration = null;
      throw err;
    });
  }
  return inspectorsMigration;
}

async function runInspectorsMigration() {
  const target = "inspectors";
  const metaCol = await getMetaCollection(target);
  const done = await metaCol.findOne({ _id: "inspectors-tenancy-v1" });
  if (done?.done) return;

  const exists = await hasStoredOperationalData(target);
  if (!exists) {
    await metaCol.updateOne(
      { _id: "inspectors-tenancy-v1" },
      { $set: { done: true, at: new Date(), empty: true } },
      { upsert: true },
    );
    return;
  }

  const meta = await metaCol.findOne({ _id: "main" });
  const source =
    meta?.schema === "collections"
      ? await assembleState(meta.revision, undefined, null, target)
      : await migrateLegacyState(undefined, target);

  const orgId = await createLegacyOrganization(source.workers);
  const revision = source.revision || 1;
  await replaceModels(
    snapshotOf(source),
    revision,
    undefined,
    { orgId, module: "inspectors" },
    target,
  );
  const db = await getDb(target);
  for (const name of Object.values(MODEL_COLLECTIONS)) {
    await db.collection(name).deleteMany({ orgId: { $exists: false } });
  }
  const audit = await getAuditCollection(target);
  await audit.updateMany(
    { orgId: { $exists: false } },
    { $set: { orgId, module: "inspectors" } },
  );
  await metaCol.updateOne(
    { _id: "inspectors-tenancy-v1" },
    { $set: { done: true, at: new Date(), orgId } },
    { upsert: true },
  );
}

function modelId(doc) {
  return String(doc?.id || doc?._id || "");
}

/** Copy documents that still sit in the module collections without an organization. */
export function modelsMissingFromScope(unscoped, scopedIds) {
  const have = new Set(scopedIds);
  const missing = [];
  for (const doc of unscoped || []) {
    const id = modelId(doc);
    if (!id || have.has(id)) continue;
    have.add(id);
    missing.push(doc);
  }
  return missing;
}

let inspectorsUnscopedEmpty = false;

export async function importUnscopedInspectorModels(scope) {
  if (inspectorsUnscopedEmpty) return 0;
  const db = await getDb("inspectors");
  const metaCol = await getMetaCollection("inspectors");
  let imported = 0;
  let sawUnscoped = false;
  for (const name of Object.values(MODEL_COLLECTIONS)) {
    const col = db.collection(name);
    const unscoped = await col
      .find({ orgId: { $exists: false } })
      .limit(1)
      .toArray();
    if (unscoped.length === 0) continue;
    sawUnscoped = true;
    const allUnscoped = await col.find({ orgId: { $exists: false } }).toArray();
    const scoped = await col
      .find(scopeFilter(scope))
      .project({ id: 1 })
      .toArray();
    const missing = modelsMissingFromScope(
      allUnscoped,
      scoped.map((doc) => modelId(doc)),
    );
    if (missing.length === 0) continue;
    const docs = missing.map((item) => {
      const { _id: _ignored, orgId: _org, module: _module, ...rest } = item;
      return stampScope({ ...rest, id: modelId(item) }, scope);
    });
    try {
      await col.insertMany(docs, { ordered: false });
    } catch (err) {
      const writeErrors = Array.isArray(err?.writeErrors)
        ? err.writeErrors
        : [];
      const onlyDuplicates =
        err?.code === 11000 ||
        (writeErrors.length > 0 &&
          writeErrors.every((entry) => entry.code === 11000));
      if (!onlyDuplicates) throw err;
    }
    imported += missing.length;
  }
  if (!sawUnscoped) inspectorsUnscopedEmpty = true;
  if (imported > 0) {
    const meta = await metaCol.findOne({ _id: metaIdFor(scope) });
    const revision = Number(meta?.revision ?? 0);
    const historyRevision = Number(meta?.historyRevision ?? revision) + imported;
    await metaCol.updateOne(
      { _id: metaIdFor(scope) },
      {
        $set: {
          revision: revision + imported,
          historyRevision,
          updatedAt: new Date(),
        },
      },
    );
  }
  return imported;
}

const stateCache = new Map();
const historyCache = new Map();
const workerPortalCache = new Map();
/** Soft TTL only used for logging/metrics; matching revision always hits. */
const STATE_CACHE_MS = 120_000;

function stateCacheKey(scope) {
  return `${scope.orgId}:${scope.module}`;
}

function rememberState(scope, state) {
  if (!scope?.orgId) return;
  stateCache.set(stateCacheKey(scope), {
    at: Date.now(),
    revision: Number(state.revision ?? 0),
    state,
  });
}

function conflictError(state) {
  const err = new Error(
    "הנתונים עודכנו ע״י מנהל אחר. רעננו את המסך וחזרו על השינוי.",
  );
  err.status = 409;
  err.current = publicData(state);
  return err;
}

/** Bump the revision only if it is still `current`. Match the stored BSON value, not a re-typed number. */
async function claimRevision(scope, current) {
  const target = targetForScope(scope);
  const meta = await getMetaCollection(target);
  const doc = await meta.findOne({ _id: metaIdFor(scope) });
  const live = Number(doc?.revision ?? 0);
  if (!doc || live !== Number(current)) return null;
  const nextRevision = live + 1;
  const bumped = await meta.updateOne(
    { _id: doc._id, revision: doc.revision },
    {
      $set: {
        schema: "collections",
        revision: nextRevision,
        historyRevision: nextRevision,
        updatedAt: new Date(),
      },
    },
  );
  if (bumped.modifiedCount !== 1) return null;
  return nextRevision;
}

function shiftDocId(scope, id) {
  return `${scope.orgId}:${scope.module}:${id}`;
}
export function invalidateStateCache(scope) {
  if (!scope?.orgId) {
    stateCache.clear();
    workerPortalCache.clear();
    return;
  }
  stateCache.delete(stateCacheKey(scope));
  const prefix = `${stateCacheKey(scope)}:wp:`;
  for (const key of [...workerPortalCache.keys()]) {
    if (key.startsWith(prefix)) workerPortalCache.delete(key);
  }
}

export async function readState(scope) {
  if (!scope?.orgId || !scope?.module) {
    const err = new Error("חסר הקשר ארגון");
    err.status = 400;
    throw err;
  }
  const target = targetForScope(scope);
  if (target === "inspectors") {
    await migrateInspectorsDatabase();
    await importUnscopedInspectorModels(scope);
  } else {
    await migrateLegacyTenancy();
  }
  const metaCol = await getMetaCollection(target);
  const meta = await metaCol.findOne({ _id: metaIdFor(scope) });
  if (meta?.schema === "collections") {
    const key = stateCacheKey(scope);
    const cached = stateCache.get(key);
    const revision = Number(meta.revision ?? 0);
    // Same revision → always reuse in-memory state (no TTL rebuild).
    if (cached && cached.revision === revision) {
      cached.at = Date.now();
      return cached.state;
    }
    const state = await assembleState(
      meta.revision,
      undefined,
      scope,
      target,
      meta.historyRevision ?? meta.revision,
    );
    stateCache.set(key, { at: Date.now(), revision, state });
    return state;
  }
  return emptyState();
}

/**
 * True when the client's known revision matches the live meta revision.
 * Avoids assembling the full AppData payload on refresh when nothing changed.
 */
export async function clientRevisionIsCurrent(scope, knownRevision) {
  if (!scope?.orgId || !scope?.module) return false;
  const known = Number(knownRevision);
  if (!Number.isFinite(known)) return false;
  const target = targetForScope(scope);
  if (target === "inspectors") {
    await migrateInspectorsDatabase();
  } else {
    await migrateLegacyTenancy();
  }
  const cached = stateCache.get(stateCacheKey(scope));
  if (cached && cached.revision === known) return true;
  const metaCol = await getMetaCollection(target);
  const meta = await metaCol.findOne(
    { _id: metaIdFor(scope) },
    { projection: { revision: 1 } },
  );
  return Number(meta?.revision ?? 0) === known;
}

/**
 * Lean org snapshot for the worker portal — date-ranged shifts only,
 * no full history / customs brokers / incidents assembly.
 * @param {{ orgId: string, module: string }} scope
 * @param {{ fromDate?: string, toDate?: string, workerIds?: string[], includeShifts?: boolean, includeLanes?: boolean, includeModels?: boolean, includeQuestions?: boolean }} [opts]
 */
export async function loadWorkerPortalBundle(scope, opts = {}) {
  if (!scope?.orgId || !scope?.module) {
    const err = new Error("חסר הקשר ארגון");
    err.status = 400;
    throw err;
  }
  const target = targetForScope(scope);
  if (target === "inspectors") {
    await migrateInspectorsDatabase();
    await importUnscopedInspectorModels(scope);
  } else {
    await migrateLegacyTenancy();
  }

  const fromDate = opts.fromDate ? String(opts.fromDate) : "";
  const toDate = opts.toDate ? String(opts.toDate) : "";
  const workerIds = Array.isArray(opts.workerIds)
    ? [...new Set(opts.workerIds.map(String).filter(Boolean))]
    : [];
  const includeShifts = opts.includeShifts !== false;
  const includeLanes = opts.includeLanes !== false;
  const includeModels = opts.includeModels !== false;
  const includeQuestions =
    opts.includeQuestions !== false && scope.module === "inspectors";

  const metaCol = await getMetaCollection(target);
  const meta = await metaCol.findOne(
    { _id: metaIdFor(scope) },
    { projection: { revision: 1 } },
  );
  const revision = Number(meta?.revision ?? 0);
  const cacheKey = `${stateCacheKey(scope)}:wp:${fromDate}:${toDate}:${workerIds.join(",")}:${includeShifts ? 1 : 0}${includeLanes ? 1 : 0}${includeModels ? 1 : 0}${includeQuestions ? 1 : 0}:${revision}`;
  const cached = workerPortalCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 15_000) {
    return cached.state;
  }

  // Prefer warm full-state cache when available (managers already loaded it).
  const full = stateCache.get(stateCacheKey(scope));
  if (full && full.revision === revision) {
    const history = includeShifts
      ? (full.state.history || []).filter((shift) => {
          if (fromDate && String(shift.date || "") < fromDate) return false;
          if (toDate && String(shift.date || "") > toDate) return false;
          return true;
        })
      : [];
    let workers = full.state.workers || [];
    if (workerIds.length > 0) {
      const want = new Set(workerIds);
      workers = workers.filter((w) => want.has(String(w.id)));
    }
    const state = {
      workers,
      lanes: includeLanes ? full.state.lanes || [] : [],
      history,
      briefingSections: full.state.briefingSections || [],
      questionBank: includeQuestions ? full.state.questionBank || [] : [],
      shiftModels: includeModels ? full.state.shiftModels || [] : [],
      revision,
    };
    workerPortalCache.set(cacheKey, { at: Date.now(), state });
    return state;
  }

  const db = await getDb(target);
  const filter = scopeFilter(scope);
  const shiftFilter = { ...filter };
  if (fromDate || toDate) {
    shiftFilter.date = {};
    if (fromDate) shiftFilter.date.$gte = fromDate;
    if (toDate) shiftFilter.date.$lte = toDate;
  }

  const workerQuery =
    workerIds.length > 0
      ? { ...filter, id: { $in: workerIds } }
      : filter;

  const [
    workers,
    lanes,
    briefingSections,
    questionBank,
    shiftModels,
    shifts,
  ] = await Promise.all([
    db.collection(MODEL_COLLECTIONS.workers).find(workerQuery).toArray(),
    includeLanes
      ? db.collection(MODEL_COLLECTIONS.lanes).find(filter).toArray()
      : Promise.resolve([]),
    db.collection(MODEL_COLLECTIONS.briefingSections).find(filter).toArray(),
    includeQuestions
      ? db.collection(MODEL_COLLECTIONS.questionBank).find(filter).toArray()
      : Promise.resolve([]),
    includeModels
      ? db.collection(MODEL_COLLECTIONS.shiftModels).find(filter).toArray()
      : Promise.resolve([]),
    includeShifts
      ? db
          .collection(MODEL_COLLECTIONS.shifts)
          .find(shiftFilter)
          .sort({ date: -1, updatedAt: -1 })
          .limit(250)
          .toArray()
      : Promise.resolve([]),
  ]);

  const state = {
    workers: fromOrderedDocs(workers),
    lanes: fromOrderedDocs(lanes),
    history: fromOrderedDocs(shifts),
    briefingSections: fromOrderedDocs(briefingSections),
    questionBank: fromOrderedDocs(questionBank),
    shiftModels: fromOrderedDocs(shiftModels),
    revision,
  };
  workerPortalCache.set(cacheKey, { at: Date.now(), state });
  if (workerPortalCache.size > 80) {
    const oldest = [...workerPortalCache.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )[0];
    if (oldest) workerPortalCache.delete(oldest[0]);
  }
  return state;
}

/** Fetch a few roster rows by id without loading the full workers catalog. */
export async function findScopedWorkers(scope, ids) {
  if (!scope?.orgId || !scope?.module) return [];
  const list = [
    ...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean)),
  ];
  if (list.length === 0) return [];
  const target = targetForScope(scope);
  const db = await getDb(target);
  const docs = await db
    .collection(MODEL_COLLECTIONS.workers)
    .find({ ...scopeFilter(scope), id: { $in: list } })
    .toArray();
  return fromOrderedDocs(docs);
}

/** One page of saved shifts, newest first, without loading the whole history. */
export async function listHistoryPage(scope, query = {}) {
  if (!scope?.orgId || !scope?.module) {
    const err = new Error("חסר הקשר ארגון");
    err.status = 400;
    throw err;
  }
  const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 60);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const target = targetForScope(scope);
  const db = await getDb(target);
  const filter = { ...scopeFilter(scope) };
  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = String(query.from);
    if (query.to) filter.date.$lte = String(query.to);
  }
  const col = db.collection(MODEL_COLLECTIONS.shifts);
  const total = await col.countDocuments(filter);
  const docs = await col
    .find(filter)
    .sort({ date: -1, updatedAt: -1 })
    .skip(offset)
    .limit(limit)
    .toArray();
  return { total, offset, limit, items: fromOrderedDocs(docs) };
}

export async function writeState(data, options = {}) {
  const scope = options.scope;
  if (!scope?.orgId || !scope?.module) {
    const err = new Error("חסר הקשר ארגון");
    err.status = 400;
    throw err;
  }
  const prev = await readState(scope);
  const currentRevision = prev?.revision ?? 0;

  if (
    options.expectedRevision != null &&
    Number(options.expectedRevision) !== currentRevision
  ) {
    const err = new Error(
      "הנתונים עודכנו ע״י מנהל אחר. רעננו את המסך וחזרו על השינוי.",
    );
    err.status = 409;
    err.current = publicData(prev);
    throw err;
  }

  const normalized = normalizeData(
    data,
    scope.module === "inspectors"
      ? "inspector"
      : scope.module === "security"
        ? "security"
        : "selector",
  );
  let workers = mergeWorkerSecrets(normalized.workers, prev?.workers);
  assertOrgManagerEdits(workers, prev?.workers, options.actor);
  if (!options.skipManagerInvites) {
    assertManagersHaveEmail(workers, prev?.workers);
  }
  await assertUniqueWorkerContacts(workers, scope);

  const invited = await applyManagerInvites(workers, prev?.workers, options);
  workers = invited.workers;
  await syncManagerAccess(workers, scope.orgId, prev?.workers);

  const payload = {
    ...normalized,
    workers,
  };
  if (options.action !== "data_reset") {
    payload.history = keepSignedShifts(payload.history, prev?.history);
  }
  const nextRevision = currentRevision + 1;
  const toStore = {
    workers: payload.workers,
    lanes: payload.lanes,
    history: payload.history,
    certificationsCatalog: payload.certificationsCatalog,
    briefingSections: payload.briefingSections ?? [],
    questionBank: payload.questionBank ?? [],
    customsBrokers: payload.customsBrokers ?? [],
    shiftModels: payload.shiftModels ?? [],
    incidents: payload.incidents ?? [],
  };
  const historyChanged =
    options.action === "data_reset" ||
    JSON.stringify(toStore.history) !== JSON.stringify(prev?.history || []);

  const target = targetForScope(scope);
  await withDbTransaction(async (session) => {
    const metaCol = await getMetaCollection(target);
    const opts = session ? { session } : {};
    const meta = await metaCol.findOne({ _id: metaIdFor(scope) }, opts);
    const liveRevision = Number(meta?.revision ?? 0);
    const historyRevision = historyChanged
      ? nextRevision
      : Number(meta?.historyRevision ?? liveRevision);
    if (
      options.expectedRevision != null &&
      Number(options.expectedRevision) !== liveRevision
    ) {
      const err = new Error(
        "הנתונים עודכנו ע״י מנהל אחר. רעננו את המסך וחזרו על השינוי.",
      );
      err.status = 409;
      err.current = publicData(prev);
      throw err;
    }
    await replaceModels(
      toStore,
      nextRevision,
      session,
      scope,
      target,
      historyRevision,
      historyChanged,
    );
    if (options.action === "data_reset") {
      const db = await getDb(target);
      await db
        .collection(SHIFT_VERSIONS_COLLECTION)
        .deleteMany(scopeFilter(scope), opts);
    }
  }, target);

  const result = { ...payload, revision: nextRevision };

  if (!options.skipAudit) {
    if (options.action === "data_reset") {
      await appendAuditLog({
        action: "data_reset",
        actor: options.actor,
        details: options.details || "איפוס לכל נתוני הדוגמה",
        orgId: scope.orgId,
        module: scope.module,
      });
    } else if (prev) {
      const events = diffAppDataAuditEvents(prev, result);
      for (const ev of events) {
        await appendAuditLog({
          action: ev.action,
          actor: options.actor,
          details: ev.details,
          orgId: scope.orgId,
          module: scope.module,
        });
      }
    }
  }

  invalidateStateCache(scope);
  return publicData(result);
}

/** Bump only the operational revision (leave historyRevision alone). */
async function claimOperationalRevision(scope, current) {
  const target = targetForScope(scope);
  const meta = await getMetaCollection(target);
  const doc = await meta.findOne({ _id: metaIdFor(scope) });
  const live = Number(doc?.revision ?? 0);
  if (!doc || live !== Number(current)) return null;
  const nextRevision = live + 1;
  const bumped = await meta.updateOne(
    { _id: doc._id, revision: doc.revision },
    {
      $set: {
        schema: "collections",
        revision: nextRevision,
        updatedAt: new Date(),
      },
    },
  );
  if (bumped.modifiedCount !== 1) return null;
  return nextRevision;
}

/**
 * Append one incident without rewriting the full org snapshot.
 * Avoids long revision races when workers open fault reports.
 */
export async function appendIncident(incident, options = {}) {
  const scope = options.scope;
  if (!scope?.orgId || !scope?.module) {
    const err = new Error("חסר הקשר ארגון");
    err.status = 400;
    throw err;
  }
  const kind =
    scope.module === "inspectors"
      ? "inspector"
      : scope.module === "security"
        ? "security"
        : "selector";
  const row = normalizeData({ incidents: [incident] }, kind).incidents?.[0];
  if (!row) {
    const err = new Error("דיווח לא תקין");
    err.status = 400;
    throw err;
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) invalidateStateCache(scope);
    const latest = await readState(scope);
    if ((latest.incidents || []).some((item) => item.id === row.id)) {
      return { data: publicData(latest), incident: row };
    }
    const nextRevision = await claimOperationalRevision(
      scope,
      latest.revision ?? 0,
    );
    if (nextRevision == null) continue;

    const target = targetForScope(scope);
    const db = await getDb(target);
    const stamped = stampScope({ ...row, listOrder: -Date.now() }, scope);
    const { _id, ...doc } = stamped;
    await db.collection(MODEL_COLLECTIONS.incidents).updateOne(
      { _id },
      {
        $set: doc,
        $setOnInsert: { listOrder: doc.listOrder ?? -Date.now() },
      },
      { upsert: true },
    );

    const savedState = {
      ...latest,
      incidents: [row, ...(latest.incidents || [])],
      revision: nextRevision,
    };
    rememberState(scope, savedState);
    return { data: publicData(savedState), incident: row };
  }
  throw conflictError(await readState(scope));
}

/**
 * Patch one incident document (approve/reject) without a full-state rewrite.
 */
export async function patchIncident(id, mutator, options = {}) {
  const scope = options.scope;
  if (!scope?.orgId || !scope?.module) {
    const err = new Error("חסר הקשר ארגון");
    err.status = 400;
    throw err;
  }
  const incidentId = String(id || "").trim();
  if (!incidentId) {
    const err = new Error("חסר מזהה דיווח");
    err.status = 400;
    throw err;
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) invalidateStateCache(scope);
    const latest = await readState(scope);
    const existing = (latest.incidents || []).find(
      (item) => item && item.id === incidentId,
    );
    if (!existing) {
      const err = new Error("הדיווח לא נמצא");
      err.status = 404;
      throw err;
    }
    const patched = mutator(existing);
    if (!patched || typeof patched !== "object") {
      const err = new Error("עדכון דיווח לא תקין");
      err.status = 400;
      throw err;
    }
    const kind =
      scope.module === "inspectors"
        ? "inspector"
        : scope.module === "security"
          ? "security"
          : "selector";
    const row = normalizeData({ incidents: [patched] }, kind).incidents?.[0];
    if (!row) {
      const err = new Error("דיווח לא תקין");
      err.status = 400;
      throw err;
    }

    const nextRevision = await claimOperationalRevision(
      scope,
      latest.revision ?? 0,
    );
    if (nextRevision == null) continue;

    const target = targetForScope(scope);
    const db = await getDb(target);
    const stamped = stampScope({ ...row, listOrder: existing.listOrder ?? 0 }, scope);
    const { _id, ...doc } = stamped;
    await db
      .collection(MODEL_COLLECTIONS.incidents)
      .updateOne({ _id }, { $set: doc }, { upsert: true });

    const savedState = {
      ...latest,
      incidents: (latest.incidents || []).map((item) =>
        item.id === incidentId ? row : item,
      ),
      revision: nextRevision,
    };
    rememberState(scope, savedState);
    return { data: publicData(savedState), incident: row };
  }
  throw conflictError(await readState(scope));
}

export async function loginByPhone(phoneRaw, credentials = {}) {
  return authenticateManager(phoneRaw, credentials);
}

/** Self-service: email a new temporary password to an organization manager. */
export async function requestPasswordReset(phoneRaw) {
  return requestAccountPasswordReset(phoneRaw);
}

/** Authenticated: re-send temporary password to a manager or portal worker. */
export async function resendManagerTempPassword(workerId, actor, options = {}) {
  const scope = options.scope;
  const data = await readState(scope);
  const target = data.workers.find((w) => w.id === workerId);
  const loginRole = target ? accountRoleForWorker(target) : null;
  if (!target || !loginRole) {
    const err = new Error(
      "למשתמש אין גישת התחברות. סמנו מנהל או גישת פורטל עובד ושמרו קודם.",
    );
    err.status = 400;
    throw err;
  }
  if (!isValidEmail(target.email)) {
    const err = new Error("חובה כתובת מייל תקינה לפני שליחת סיסמה");
    err.status = 400;
    throw err;
  }

  const tempPassword = generateTempPassword();
  await sendTempPasswordEmail({
    to: target.email,
    fullName: target.fullName,
    tempPassword,
    reason: "invite",
  });

  const passwordHash = await hashPassword(tempPassword);
  const prevTarget = data.workers.find((w) => w.id === target.id);
  const isOrgManager = nextOrgManagerFlag(target, prevTarget);
  await upsertManagerAccount({
    orgId: scope.orgId,
    workerId: target.id,
    fullName: target.fullName,
    phone: target.phone,
    email: target.email,
    passwordHash,
    mustChangePassword: true,
    staffKind:
      target.staffKind === "inspector" ||
      target.staffKind === "selector" ||
      target.staffKind === "security"
        ? target.staffKind
        : "selector",
    ...(typeof isOrgManager === "boolean" ? { isOrgManager } : {}),
    role: loginRole,
  });
  await writeState(
    {
      ...data,
      workers: data.workers.map((w) =>
        w.id === target.id
          ? { ...w, passwordHash, mustChangePassword: true }
          : w,
      ),
    },
    { skipAudit: true, skipManagerInvites: true, scope },
  );

  await appendAuditLog({
    action: "manager_invite",
    actor: actor || null,
    orgId: scope.orgId,
    module: scope.module,
    details: `סיסמה זמנית נשלחה מחדש אל ${target.fullName} (${target.email})`,
  });
  return { ok: true };
}

function compactPersonName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function isShiftSignedOff(shift) {
  return Boolean(shift?.signOff && String(shift.signOff.signedAt || "").trim());
}

function signedShiftError(verb) {
  const err = new Error(`המשמרת נסגרה וננעלה. לא ניתן ${verb} אותה.`);
  err.status = 409;
  throw err;
}

/** A full data write cannot rewrite or drop a closed shift. */
function keepSignedShifts(incoming, stored) {
  const lockedById = new Map(
    (stored || []).filter(isShiftSignedOff).map((shift) => [shift.id, shift]),
  );
  if (lockedById.size === 0) return incoming || [];
  const seen = new Set();
  const next = (incoming || []).map((shift) => {
    const locked = lockedById.get(shift.id);
    if (!locked) return shift;
    seen.add(shift.id);
    return locked;
  });
  for (const [id, shift] of lockedById) {
    if (!seen.has(id)) next.push(shift);
  }
  return next;
}

/**
 * A close request must be signed with the connected manager's full name.
 * Returns true when this save is the close itself.
 */
function attachSignOff(schedule, actor) {
  const requested = schedule.signOff;
  if (!requested) {
    delete schedule.signOff;
    return false;
  }
  const typed = compactPersonName(requested.signature);
  const name = compactPersonName(actor?.fullName);
  if (!name || typed !== name) {
    const err = new Error("החתימה צריכה להיות השם המלא של המנהל שמחובר.");
    err.status = 400;
    throw err;
  }
  schedule.signOff = {
    signedAt: new Date().toISOString(),
    signerName: name,
    signerId: String(actor?.id || ""),
    signature: typed,
  };
  return true;
}

export async function upsertShift(id, body, actor, options = {}) {
  const scope = options.scope;
  const state = await readState(scope);
  const schedule = { ...body, id };
  delete schedule.actor;
  delete schedule.expectedRevision;
  if (
    schedule.assignmentMode !== "rounds" &&
    schedule.assignmentMode !== "single"
  ) {
    schedule.assignmentMode =
      schedule.audience === "selector" ||
      schedule.audience === "security" ||
      (scope?.module !== "inspectors" &&
        Array.isArray(schedule.rounds) &&
        schedule.rounds.length > 0)
        ? "rounds"
        : "single";
  }
  if (scope?.module === "inspectors") {
    schedule.audience = "inspector";
  } else if (scope?.module === "security") {
    schedule.audience = "security";
  } else if (scope?.module === "selectors") {
    schedule.audience = "selector";
  }
  if (schedule.assignmentMode !== "rounds") {
    delete schedule.rounds;
  }

  const audienceOf = (h) =>
    h?.audience === "selector"
      ? "selector"
      : h?.audience === "security"
        ? "security"
        : "inspector";
  const conflict = (state.history || []).find(
    (h) =>
      h.id !== schedule.id &&
      h.date === schedule.date &&
      h.shiftType === schedule.shiftType &&
      audienceOf(h) === audienceOf(schedule),
  );
  if (conflict) {
    const err = new Error(
      "כבר קיים שיבוץ לאותו תאריך ואותה משמרת. לא ניתן ליצור שיבוץ כפול.",
    );
    err.status = 400;
    throw err;
  }

  const idx = state.history.findIndex((h) => h.id === schedule.id);
  const isNew = idx === -1;
  const previous = isNew ? null : state.history[idx];
  if (isShiftSignedOff(previous)) signedShiftError("לערוך");
  const closing = attachSignOff(schedule, actor);
  const history = isNew
    ? [schedule, ...state.history]
    : state.history.map((h, i) =>
        i === idx ? { ...previous, ...schedule } : h,
      );

  let saved = null;
  for (let attempt = 0; attempt < 5 && !saved; attempt++) {
    if (attempt > 0) invalidateStateCache(scope);
    const latest = attempt === 0 ? state : await readState(scope);
    const foundNow = latest.history.find((h) => h.id === schedule.id);
    if (isShiftSignedOff(foundNow)) signedShiftError("לערוך");
    const latestHistory =
      attempt === 0
        ? history
        : (() => {
            const found = latest.history.findIndex((h) => h.id === schedule.id);
            return found === -1
              ? [schedule, ...latest.history]
              : latest.history.map((h, i) =>
                  i === found ? { ...h, ...schedule } : h,
                );
          })();
    const duplicate = latestHistory.find(
      (h) =>
        h.id !== schedule.id &&
        h.date === schedule.date &&
        h.shiftType === schedule.shiftType &&
        audienceOf(h) === audienceOf(schedule),
    );
    if (duplicate) {
      const err = new Error(
        "כבר קיים שיבוץ לאותו תאריך ואותה משמרת. לא ניתן ליצור שיבוץ כפול.",
      );
      err.status = 400;
      throw err;
    }
    const nextRevision = await claimRevision(scope, latest.revision ?? 0);
    if (nextRevision == null) continue;
    const target = targetForScope(scope);
    const db = await getDb(target);
    const stored = stampScope({ ...schedule }, scope);
    delete stored._id;
    const versionActor = actor
      ? {
          id: String(actor.id || ""),
          fullName: String(actor.fullName || ""),
        }
      : null;
    const versionDocs = [];
    if (previous) {
      const versionFilter = { ...scopeFilter(scope), shiftId: schedule.id };
      const hasVersions = await db
        .collection(SHIFT_VERSIONS_COLLECTION)
        .countDocuments(versionFilter);
      if (hasVersions === 0) {
        const baselineId = `baseline:${shiftDocId(scope, schedule.id)}`;
        versionDocs.push({
          _id: baselineId,
          shiftId: schedule.id,
          createdAt: String(previous.updatedAt || previous.createdAt || new Date().toISOString()),
          actor: null,
          schedule: { ...previous },
          ...(scope ? { orgId: scope.orgId, module: scope.module } : {}),
        });
      }
    }
    versionDocs.push({
      _id: randomUUID(),
      shiftId: schedule.id,
      createdAt: schedule.updatedAt || new Date().toISOString(),
      actor: versionActor,
      schedule: { ...schedule },
      ...(scope ? { orgId: scope.orgId, module: scope.module } : {}),
    });
    await withDbTransaction(async (session) => {
      const txOpts = session ? { session } : {};
      for (const version of versionDocs) {
        await db
          .collection(SHIFT_VERSIONS_COLLECTION)
          .updateOne(
            { _id: version._id },
            { $setOnInsert: version },
            { upsert: true, ...txOpts },
          );
      }
      await db.collection(MODEL_COLLECTIONS.shifts).updateOne(
        { _id: shiftDocId(scope, schedule.id) },
        {
          $set: stored,
          $setOnInsert: { listOrder: -Date.now() },
        },
        { upsert: true, ...txOpts },
      );
    }, target);
    const savedState = {
      ...latest,
      history: latestHistory,
      revision: nextRevision,
    };
    rememberState(scope, savedState);
    saved = publicData(savedState);
  }
  if (!saved) throw conflictError(await readState(scope));

  const header = shiftAuditHeader(schedule);
  const movement = summarizeAssignmentChanges(previous, schedule, {
    workers: state.workers,
    lanes: state.lanes,
  });
  const details = movement ? `${header} · ${movement}` : header;

  await appendAuditLog({
    action: closing ? "shift_signoff" : isNew ? "shift_save" : "shift_update",
    actor,
    details: closing
      ? `נסגרה משמרת ${schedule.date} · ${schedule.shiftType} · ${schedule.signOff.signerName}`
      : details,
    orgId: scope?.orgId,
    module: scope?.module,
  });

  if (scope?.orgId && scope?.module && !closing) {
    try {
      const { notifyWorkersOfAssignmentChanges } = await import(
        "./workerAlerts.js"
      );
      await notifyWorkersOfAssignmentChanges({
        previous,
        next: schedule,
        scope,
        actor,
        lanes: state.lanes,
        models: state.shiftModels,
      });
    } catch (err) {
      console.error(
        "[worker-alerts] assignment notice failed",
        err?.message || err,
      );
    }
  }

  return saved;
}

export async function listShiftVersions(id, options = {}) {
  const scope = options.scope;
  const target = targetForScope(scope);
  const db = await getDb(target);
  const col = db.collection(SHIFT_VERSIONS_COLLECTION);
  const filter = { ...scopeFilter(scope), shiftId: String(id) };
  const existingCount = await col.countDocuments(filter);
  if (existingCount === 0) {
    const state = await readState(scope);
    const current = state.history.find((shift) => shift.id === String(id));
    if (current) {
      const baselineId = `baseline:${shiftDocId(scope, id)}`;
      const baseline = {
        _id: baselineId,
        shiftId: String(id),
        createdAt: String(current.updatedAt || current.createdAt || new Date().toISOString()),
        actor: null,
        schedule: { ...current },
        ...(scope ? { orgId: scope.orgId, module: scope.module } : {}),
      };
      await col.updateOne(
        { _id: baselineId },
        { $setOnInsert: baseline },
        { upsert: true },
      );
    }
  }
  const docs = await col
    .find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(100)
    .toArray();
  return docs.map((doc) => ({
    id: String(doc._id),
    createdAt: String(doc.createdAt || ""),
    actorName: doc.actor?.fullName || "מנהל",
    date: String(doc.schedule?.date || ""),
    shiftType: String(doc.schedule?.shiftType || ""),
  }));
}

export async function restoreShiftVersion(id, versionId, actor, options = {}) {
  const scope = options.scope;
  const state = await readState(scope);
  const current = state.history.find((shift) => shift.id === id);
  if (!current) {
    const err = new Error("המשמרת לא נמצאה");
    err.status = 404;
    throw err;
  }
  if (isShiftSignedOff(current)) signedShiftError("לשחזר");

  const target = targetForScope(scope);
  const db = await getDb(target);
  const version = await db.collection(SHIFT_VERSIONS_COLLECTION).findOne({
    _id: String(versionId),
    shiftId: String(id),
    ...scopeFilter(scope),
  });
  if (!version?.schedule) {
    const err = new Error("הגרסה לא נמצאה");
    err.status = 404;
    throw err;
  }

  const schedule = {
    ...version.schedule,
    id,
    updatedAt: new Date().toISOString(),
  };
  delete schedule.signOff;
  const saved = await upsertShift(id, schedule, actor, options);
  await appendAuditLog({
    action: "shift_version_restore",
    actor,
    details: `שוחזרה גרסת שיבוץ ${schedule.date} · ${schedule.shiftType} · נוצרה ב־${String(version.createdAt || "").slice(0, 16)}`,
    orgId: scope?.orgId,
    module: scope?.module,
  });
  return saved;
}

export async function listShiftHandoffs(options = {}) {
  const scope = options.scope;
  const db = await getDb(targetForScope(scope));
  const docs = await db
    .collection(SHIFT_HANDOFF_COLLECTION)
    .find(scopeFilter(scope))
    .sort({ status: 1, updatedAt: -1 })
    .limit(300)
    .toArray();
  const prefix = scope ? `${scope.orgId}:${scope.module}:` : "";
  return docs.map(({ _id, orgId: _org, module: _module, ...note }) => {
    const storedId = String(_id);
    return {
      ...note,
      id: prefix && storedId.startsWith(prefix)
        ? storedId.slice(prefix.length)
        : storedId,
    };
  });
}

export async function createShiftHandoff(body = {}, actor, options = {}) {
  const scope = options.scope;
  const title = String(body.title || "").trim().slice(0, 120);
  const details = String(body.details || "").trim().slice(0, 4000);
  if (!title || !details) {
    const err = new Error("יש למלא כותרת ופירוט");
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  const note = {
    id,
    title,
    details,
    ownerWorkerId: String(body.ownerWorkerId || "").trim().slice(0, 120),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate || ""))
      ? String(body.dueDate)
      : "",
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ""))
      ? String(body.date)
      : "",
    shiftType: ["morning", "afternoon", "afternoonA", "afternoonB", "night"].includes(body.shiftType)
      ? body.shiftType
      : "",
    status: "open",
    createdAt: now,
    updatedAt: now,
    createdBy: String(actor?.fullName || "מנהל"),
  };
  const db = await getDb(targetForScope(scope));
  await db.collection(SHIFT_HANDOFF_COLLECTION).insertOne(stampScope(note, scope));
  await appendAuditLog({
    action: "shift_handoff_create",
    actor,
    details: `נוספה למסירת משמרת: ${title}`,
    orgId: scope?.orgId,
    module: scope?.module,
  });
  return note;
}

export async function updateShiftHandoff(id, body = {}, actor, options = {}) {
  const scope = options.scope;
  const db = await getDb(targetForScope(scope));
  const col = db.collection(SHIFT_HANDOFF_COLLECTION);
  const prefix = scope ? `${scope.orgId}:${scope.module}:` : "";
  const requestedId = String(id);
  const storedId = prefix && !requestedId.startsWith(prefix)
    ? `${prefix}${requestedId}`
    : requestedId;
  const filter = { _id: storedId, ...scopeFilter(scope) };
  const current = await col.findOne(filter);
  if (!current) {
    const err = new Error("הפריט לא נמצא");
    err.status = 404;
    throw err;
  }
  const status = body.status === "closed" ? "closed" : body.status === "open" ? "open" : current.status;
  const now = new Date().toISOString();
  const changes = { status, updatedAt: now };
  if (body.title != null) changes.title = String(body.title).trim().slice(0, 120);
  if (body.details != null) changes.details = String(body.details).trim().slice(0, 4000);
  if (body.date != null) {
    const date = String(body.date).trim();
    changes.date = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  }
  if (body.shiftType != null) {
    changes.shiftType = ["morning", "afternoon", "afternoonA", "afternoonB", "night"].includes(body.shiftType)
      ? body.shiftType
      : "";
  }
  if (body.ownerWorkerId != null) changes.ownerWorkerId = String(body.ownerWorkerId).trim().slice(0, 120);
  if (body.dueDate != null) {
    const dueDate = String(body.dueDate).trim();
    changes.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : "";
  }
  const nextTitle = body.title == null ? current.title : changes.title;
  const nextDetails = body.details == null ? current.details : changes.details;
  if (!String(nextTitle || "").trim() || !String(nextDetails || "").trim()) {
    const err = new Error("יש למלא כותרת ופירוט");
    err.status = 400;
    throw err;
  }
  if (status === "closed" && current.status !== "closed") {
    changes.closedAt = now;
    changes.closedBy = String(actor?.fullName || "מנהל");
  } else if (status === "open") {
    changes.closedAt = null;
    changes.closedBy = null;
  }
  await col.updateOne(filter, { $set: changes });
  await appendAuditLog({
    action: "shift_handoff_update",
    actor,
    details: `${status === "closed" ? "נסגרה" : "עודכנה"} מסירת משמרת: ${changes.title}`,
    orgId: scope?.orgId,
    module: scope?.module,
  });
  const { _id, orgId: _org, module: _module, ...updated } = await col.findOne(filter);
  return { ...updated, id: String(_id) };
}

export async function deleteShiftHandoff(id, actor, options = {}) {
  const scope = options.scope;
  const db = await getDb(targetForScope(scope));
  const col = db.collection(SHIFT_HANDOFF_COLLECTION);
  const prefix = scope ? `${scope.orgId}:${scope.module}:` : "";
  const requestedId = String(id);
  const storedId = prefix && !requestedId.startsWith(prefix)
    ? `${prefix}${requestedId}`
    : requestedId;
  const filter = { _id: storedId, ...scopeFilter(scope) };
  const current = await col.findOne(filter);
  if (!current) {
    const err = new Error("הפריט לא נמצא");
    err.status = 404;
    throw err;
  }
  await col.deleteOne(filter);
  await appendAuditLog({
    action: "shift_handoff_delete",
    actor,
    details: `נמחקה ממסירת משמרת: ${String(current.title || "נושא ללא כותרת")}`,
    orgId: scope?.orgId,
    module: scope?.module,
  });
  return { ok: true };
}

export async function recordSelfHeal(id, body, actor, options = {}) {
  const scope = options.scope;
  const state = await readState(scope);
  const existing = (state.history || []).find((shift) => shift.id === id);
  if (!existing) {
    const err = new Error(
      "השיבוץ עדיין לא נשמר. אחרי האישור צריך לשמור את המשמרת.",
    );
    err.status = 404;
    throw err;
  }
  if (isShiftSignedOff(existing)) signedShiftError("לשקם");
  const problem = validateSelfHeal(body, state.workers, state.lanes);
  if (problem) {
    const err = new Error(problem);
    err.status = 400;
    throw err;
  }
  const event = {
    id: randomUUID(),
    at: new Date().toISOString(),
    atMinutes: Number(body?.atMinutes) || 0,
    removedWorkerId: String(body?.removedWorkerId || ""),
    summary: String(body?.summary || ""),
    lines: Array.isArray(body?.lines)
      ? body.lines.map((line) => String(line))
      : [],
    moves: Array.isArray(body?.moves) ? body.moves : [],
  };
  const schedule = {
    ...existing,
    assignments: body?.assignments ?? existing.assignments,
    rounds: body?.rounds ?? existing.rounds,
    presentWorkerIds: body?.presentWorkerIds ?? existing.presentWorkerIds,
    gateManagerWorkerId:
      body?.gateManagerWorkerId === undefined
        ? existing.gateManagerWorkerId
        : body.gateManagerWorkerId,
    seatSegments: body?.seatSegments ?? existing.seatSegments,
    seatSpan: body?.seatSpan ?? existing.seatSpan,
    frozenLaneIds: body?.frozenLaneIds ?? existing.frozenLaneIds,
    explanations: body?.explanations ?? existing.explanations,
    isSelfHealed: true,
    shiftEvents: [...(existing.shiftEvents || []), event],
    id,
  };
  const saved = await upsertShift(id, schedule, actor, options);
  await appendAuditLog({
    action: "shift_self_heal",
    actor,
    details:
      event.summary || `שיקום לוח ${existing.date} · ${existing.shiftType}`,
    orgId: scope?.orgId,
    module: scope?.module,
  });
  return saved;
}

export async function deleteShift(id, actor, options = {}) {
  const scope = options.scope;
  const state = await readState(scope);
  const existing = state.history.find((h) => h.id === id);
  if (!existing) return publicData(state);
  if (isShiftSignedOff(existing)) signedShiftError("למחוק");

  let saved = null;
  let removed = existing;
  for (let attempt = 0; attempt < 5 && !saved; attempt++) {
    if (attempt > 0) invalidateStateCache(scope);
    const latest = attempt === 0 ? state : await readState(scope);
    const targetShift = latest.history.find((h) => h.id === id);
    if (!targetShift) return publicData(latest);
    if (isShiftSignedOff(targetShift)) signedShiftError("למחוק");
    removed = targetShift;
    const nextRevision = await claimRevision(scope, latest.revision ?? 0);
    if (nextRevision == null) continue;
    const target = targetForScope(scope);
    const db = await getDb(target);
    await db.collection(MODEL_COLLECTIONS.shifts).deleteOne({
      _id: shiftDocId(scope, id),
    });
    await db
      .collection(SHIFT_VERSIONS_COLLECTION)
      .deleteMany({ ...scopeFilter(scope), shiftId: String(id) });
    const savedState = {
      ...latest,
      history: latest.history.filter((h) => h.id !== id),
      revision: nextRevision,
    };
    rememberState(scope, savedState);
    saved = publicData(savedState);
  }
  if (!saved) throw conflictError(await readState(scope));

  await appendAuditLog({
    action: "shift_delete",
    actor,
    details: `נמחק שיבוץ ${removed.date} · ${removed.shiftType}`,
    orgId: scope?.orgId,
    module: scope?.module,
  });
  return saved;
}
