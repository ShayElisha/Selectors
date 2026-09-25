import type { BriefingSection, InspectorQuestion } from '../types'

export function sortBriefingSections(
  sections: BriefingSection[],
): BriefingSection[] {
  return sections
    .slice()
    .sort(
      (a, b) =>
        a.order - b.order || a.title.localeCompare(b.title, 'he'),
    )
}

export function sortQuestionBank(
  questions: InspectorQuestion[],
): InspectorQuestion[] {
  return questions
    .slice()
    .sort(
      (a, b) =>
        a.order - b.order || a.prompt.localeCompare(b.prompt, 'he'),
    )
}

export function normalizeBriefingSection(raw: unknown): BriefingSection | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = String(o.id || '').trim()
  const title = String(o.title || '').trim()
  const body = String(o.body || '').trim()
  if (!id || !title) return null
  const order = Number(o.order)
  return {
    id,
    title,
    body,
    order: Number.isFinite(order) ? order : 0,
    updatedAt: String(o.updatedAt || new Date().toISOString()),
    ...(typeof o.updatedBy === 'string' && o.updatedBy.trim()
      ? { updatedBy: o.updatedBy.trim() }
      : {}),
  }
}

/** Migrate legacy multiple-choice rows into a verbal answer when possible. */
function legacyAnswerFromOptions(o: Record<string, unknown>): string {
  const direct = String(o.answer || '').trim()
  if (direct) return direct
  const options = Array.isArray(o.options)
    ? o.options.map((x) => String(x ?? '').trim()).filter(Boolean)
    : []
  if (options.length === 0) {
    return String(o.explanation || '').trim()
  }
  let correctIndex = Math.trunc(Number(o.correctIndex))
  if (!Number.isFinite(correctIndex) || correctIndex < 0) correctIndex = 0
  if (correctIndex >= options.length) correctIndex = 0
  const picked = options[correctIndex] ?? ''
  const explanation = String(o.explanation || '').trim()
  return explanation ? `${picked} — ${explanation}` : picked
}

export function normalizeQuestionBankItem(
  raw: unknown,
): InspectorQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = String(o.id || '').trim()
  const prompt = String(o.prompt || '').trim()
  const answer = legacyAnswerFromOptions(o)
  if (!id || !prompt || !answer) return null
  const order = Number(o.order)
  return {
    id,
    prompt,
    answer,
    order: Number.isFinite(order) ? order : 0,
    updatedAt: String(o.updatedAt || new Date().toISOString()),
    ...(typeof o.updatedBy === 'string' && o.updatedBy.trim()
      ? { updatedBy: o.updatedBy.trim() }
      : {}),
  }
}

export function normalizeBriefingSections(raw: unknown): BriefingSection[] {
  if (!Array.isArray(raw)) return []
  return sortBriefingSections(
    raw
      .map(normalizeBriefingSection)
      .filter((x): x is BriefingSection => x != null),
  )
}

export function normalizeQuestionBank(raw: unknown): InspectorQuestion[] {
  if (!Array.isArray(raw)) return []
  return sortQuestionBank(
    raw
      .map(normalizeQuestionBankItem)
      .filter((x): x is InspectorQuestion => x != null),
  )
}

/** Re-index order 0..n-1 after reorder. */
export function reindexOrders<T extends { order: number }>(items: T[]): T[] {
  return items.map((item, i) => ({ ...item, order: i }))
}

export function defaultBriefingSeed(): BriefingSection[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'brief-seed-1',
      title: 'פתיחת משמרת',
      body: 'בדקו נוכחות, ציוד ומצב העמדות לפני תחילת השיבוץ. ודאו שכל בודק יודע את הנתיב והדגשים למשמרת.',
      order: 0,
      updatedAt: now,
    },
    {
      id: 'brief-seed-2',
      title: 'בטיחות ותשומת לב',
      body: 'שמרו על ערנות בעמדות עמוסות. דווחו מיד על תקלה, חשד או מצב חריג למנהל המשמרת.',
      order: 1,
      updatedAt: now,
    },
    {
      id: 'brief-seed-3',
      title: 'מסירה בין משמרות',
      body: 'בסיום — העבירו דגשים פתוחים למשמרת הבאה (נתיבים בעייתיים, חוסרים, אירועים). אל תסתמכו על זיכרון בלבד.',
      order: 2,
      updatedAt: now,
    },
  ]
}

export function defaultQuestionSeed(): InspectorQuestion[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'q-seed-1',
      prompt: 'מה עושים כשחסר בודק בעמדה לפי התקן?',
      answer:
        'מדווחים למנהל המשמרת ומתאימים שיבוץ או תגבור — לא משאירים עמדה חסרה בלי דיווח.',
      order: 0,
      updatedAt: now,
    },
    {
      id: 'q-seed-2',
      prompt: 'מתי חשוב לבדוק הסמכות לפני שיבוץ לנתיב?',
      answer:
        'כשלנתיב יש דרישת הסמכה (למשל מכס) — משבצים רק בודקים מוסמכים.',
      order: 1,
      updatedAt: now,
    },
  ]
}
