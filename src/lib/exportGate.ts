/**
 * Export / share is allowed only for a shift that already exists in history
 * with no pending local edits.
 */
export function exportBlockedReason(args: {
  draftId: string
  historyIds: Iterable<string>
  draftDirty: boolean
  boardDirty?: boolean
}): string | null {
  const saved = [...args.historyIds].includes(args.draftId)
  if (!saved) {
    return 'שמרו את השיבוץ במערכת לפני ייצוא או שיתוף.'
  }
  if (args.draftDirty || args.boardDirty) {
    return 'יש שינויים שלא נשמרו. שמרו לפני ייצוא או שיתוף.'
  }
  return null
}
