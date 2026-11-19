import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { connectMock, closeMock, transactionMock, MongoClient } = vi.hoisted(() => {
  const connectMock = vi.fn()
  const closeMock = vi.fn(async () => {})
  const transactionMock = vi.fn(async (fn) => fn())
  class MongoClient {
    constructor() {
      this.connect = connectMock
      this.close = closeMock
      this.db = () => ({ collection: () => ({}) })
      this.startSession = () => ({
        withTransaction: (...args) => transactionMock(...args),
        endSession: async () => {},
      })
    }
  }
  return { connectMock, closeMock, transactionMock, MongoClient }
})

vi.mock('mongodb', () => ({ MongoClient }))

describe('db TLS error mapping', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    connectMock.mockReset().mockResolvedValue(undefined)
    transactionMock.mockImplementation(async (fn) => fn())
    vi.stubEnv('MONGODB_URI', 'mongodb://localhost:27017/selectors')
    vi.stubEnv('MONGODB_URI_SECURITY', 'mongodb://localhost:27017/security')
    globalThis.__mongoClients = {}
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    globalThis.__mongoClients = {}
  })

  it('maps OpenSSL alert 80 to a Hebrew message without leaking the dump', async () => {
    const { mapDbError, isDbTlsError } = await import('./db.js')
    const raw =
      'C0387A97767F0000:error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:ssl/record/rec_layer_s3.c:918:SSL alert number 80'
    expect(isDbTlsError(raw)).toBe(true)
    const mapped = mapDbError(new Error(raw), 'security')
    expect(mapped.message).toMatch(/מאבטחים/)
    expect(mapped.message).not.toMatch(/ssl3_read_bytes|SSL alert number 80|C0387A/i)
    expect(mapped.status).toBe(503)
  })

  it('retries TLS strategies then clears the cached rejected client', async () => {
    const tlsErr = Object.assign(
      new Error(
        'C0387A97767F0000:error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:ssl/record/rec_layer_s3.c:918:SSL alert number 80',
      ),
      { code: 'EPROTO' },
    )
    connectMock.mockRejectedValue(tlsErr)

    const { getClient } = await import('./db.js')
    await expect(getClient('security')).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/מאבטחים/),
    })
    expect(connectMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(globalThis.__mongoClients?.security).toBeUndefined()

    connectMock.mockResolvedValueOnce(undefined)
    const client = await getClient('security')
    expect(client).toBeTruthy()
    expect(globalThis.__mongoClients?.security).toBeTruthy()
  })

  it('does not retry a transaction callback without a transaction', async () => {
    transactionMock.mockRejectedValueOnce(
      Object.assign(new Error('Transaction numbers are only allowed on a replica set member'), {
        code: 20,
      }),
    )
    const { withDbTransaction } = await import('./db.js')
    const write = vi.fn()

    await expect(
      withDbTransaction(async () => write(), 'selectors'),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/שינויים חלקיים/),
    })
    expect(write).not.toHaveBeenCalled()
  })
})
