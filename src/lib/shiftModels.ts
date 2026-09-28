import type { AppModule } from '../auth'
import type { ShiftModel } from '../types'

export type { ShiftModel }

export function defaultShiftModels(module: AppModule): ShiftModel[] {
  if (module === 'inspectors') {
    return [
      { id: 'morning', name: 'בוקר', startMinutes: 6 * 60, endMinutes: 14 * 60 + 30, order: 0 },
      { id: 'afternoon', name: 'צהריים', startMinutes: 14 * 60 + 30, endMinutes: 21 * 60 + 30, order: 1 },
      { id: 'night', name: 'לילה', startMinutes: 21 * 60 + 30, endMinutes: 6 * 60, order: 2 },
    ]
  }
  return [
    { id: 'morning', name: 'בוקר', startMinutes: 6 * 60, endMinutes: 15 * 60, order: 0 },
    { id: 'afternoonA', name: 'צהריים א', startMinutes: 14 * 60 + 30, endMinutes: 18 * 60 + 30, order: 1 },
    { id: 'afternoonB', name: 'צהריים ב', startMinutes: 18 * 60, endMinutes: 21 * 60 + 30, order: 2 },
    { id: 'night', name: 'לילה', startMinutes: 21 * 60, endMinutes: 6 * 60 + 30, order: 3 },
  ]
}

export function normalizeShiftModels(raw: unknown): ShiftModel[] {
  if (!Array.isArray(raw)) return []
  const models: ShiftModel[] = []
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const row = item as Partial<ShiftModel>
    const id = String(row.id || '').trim()
    const name = String(row.name || '').trim()
    const startMinutes = Number(row.startMinutes)
    const endMinutes = Number(row.endMinutes)
    if (!id || !name) return
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return
    models.push({
      id,
      name,
      startMinutes: Math.max(0, Math.round(startMinutes)),
      endMinutes: Math.max(0, Math.round(endMinutes)),
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
    })
  })
  return models.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'he'))
}

/** Saved models for this module, or the built-in list when none were saved yet. */
export function resolveShiftModels(
  saved: ShiftModel[] | undefined,
  module: AppModule,
): ShiftModel[] {
  const normalized = normalizeShiftModels(saved)
  return normalized.length > 0 ? normalized : defaultShiftModels(module)
}

export function shiftModelById(
  models: ShiftModel[],
  id: string,
): ShiftModel | undefined {
  return models.find((model) => model.id === id)
}

export function shiftModelLabel(models: ShiftModel[], id: string): string {
  return shiftModelById(models, id)?.name || id
}

/** Absolute end on a timeline that may pass midnight. */
export function shiftModelAbsoluteEnd(model: ShiftModel): number {
  if (model.endMinutes <= model.startMinutes) return model.endMinutes + 24 * 60
  return model.endMinutes
}

export function formatMinutes(minutes: number): string {
  const day = 24 * 60
  const m = ((minutes % day) + day) % day
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function formatShiftModelWindow(model: ShiftModel): string {
  const overnight = model.endMinutes <= model.startMinutes
  const text = `${formatMinutes(model.startMinutes)} עד ${formatMinutes(model.endMinutes)}`
  return overnight ? `${text} (למחרת)` : text
}

export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function toDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentShiftModel(
  models: ShiftModel[],
  now = new Date(),
): { date: string; model: ShiftModel } {
  const ordered = [...models].sort((a, b) => a.order - b.order)
  const minutes = now.getHours() * 60 + now.getMinutes()
  const today = toDateISO(now)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = toDateISO(yesterdayDate)

  for (const model of ordered) {
    const overnight = model.endMinutes <= model.startMinutes
    if (!overnight && minutes >= model.startMinutes && minutes < model.endMinutes) {
      return { date: today, model }
    }
    if (overnight && minutes >= model.startMinutes) {
      return { date: today, model }
    }
    if (overnight && minutes < model.endMinutes) {
      return { date: yesterday, model }
    }
  }
  return { date: today, model: ordered[0]! }
}
