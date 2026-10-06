declare module '*loadRest.js' {
  export const LOAD_REST_DELTA: number
  export function israelDateISO(now?: Date): string
  export function israelYesterdayISO(now?: Date): string
  export function workerWorkedOnShift(
    workerId: string,
    shift: Record<string, unknown>,
  ): boolean
  export function workerWorkedOnDate(
    workerId: string,
    shifts: Record<string, unknown>[],
    date: string,
  ): boolean
  export function runDailyLoadRest(opts?: {
    date?: string
    now?: Date
  }): Promise<unknown>
  export function scheduleLocalLoadRestCron(): () => void
}
