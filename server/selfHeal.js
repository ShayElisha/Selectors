/**
 * Checks a healed board before it is written.
 * Ranking stays in the assignment algorithm; this only rejects a board
 * that breaks a hard rule.
 */
export function validateSelfHeal(body, workers, lanes) {
  const workerById = new Map((workers || []).map((worker) => [worker.id, worker]))
  const laneById = new Map((lanes || []).map((lane) => [lane.id, lane]))
  const rounds = Array.isArray(body?.rounds) ? body.rounds : []
  const boards = rounds.length
    ? rounds.map((round) => round?.assignments || [])
    : [Array.isArray(body?.assignments) ? body.assignments : []]

  for (const rows of boards) {
    const seen = new Set()
    for (const row of rows) {
      const lane = laneById.get(row?.laneId)
      for (const workerId of row?.workerIds || []) {
        if (!workerId) continue
        if (seen.has(workerId)) {
          return 'אדם לא יכול לשבת בשני מקומות באותו סבב.'
        }
        seen.add(workerId)
        const worker = workerById.get(workerId)
        if (!worker || worker.status === 'archived') {
          return 'אחד האנשים בשיקום לא קיים או בארכיון.'
        }
        const required = Array.isArray(lane?.requiredCertifications)
          ? lane.requiredCertifications
          : []
        const held = new Set(worker.certifications || [])
        if (required.some((cert) => !held.has(cert))) {
          return 'השיקום שם אדם בנתיב שאין לו את ההסמכה שלו.'
        }
      }
    }
  }
  return ''
}
