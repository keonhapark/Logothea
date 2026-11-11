import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('../../services/KisService', () => ({
  KisService: { inquireFill: vi.fn(), getBalance: vi.fn(), getCurrentPrice: vi.fn(), placeOrder: vi.fn() },
}))
vi.mock('../../services/BackendClient', () => ({
  BackendClient: {
    getTrades: vi.fn(),
    sendCallback: vi.fn().mockResolvedValue(undefined),
    recordManualTrade: vi.fn().mockResolvedValue(undefined),
    syncPortfolio: vi.fn().mockResolvedValue(undefined),
    getAssetHistory: vi.fn().mockResolvedValue([]),
  },
}))

import { registerKisHandlers } from '../kisHandlers'
import { IPC_CHANNELS } from '../../../lib/ipcChannels'
import { mainState } from '../../store/mainState'
import { KisService } from '../../services/KisService'
import { BackendClient } from '../../services/BackendClient'

const Kis = KisService as unknown as { inquireFill: ReturnType<typeof vi.fn> }
const Backend = BackendClient as unknown as {
  getTrades: ReturnType<typeof vi.fn>
  sendCallback: ReturnType<typeof vi.fn>
}

function handler() {
  const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>
  const call = handleMock.mock.calls.find(
    (c) => c[0] === IPC_CHANNELS.TRADES_RECONCILE_PENDING,
  )
  if (!call) throw new Error('채널 미등록')
  return call[1] as (e: unknown) => Promise<{ checked: number; reconciled: number; failed: number }>
}

const PENDING_WMT = { id: 10, ticker: 'WMT', status: 'PENDING', brokerOrderId: '0000044600' }

beforeEach(() => {
  ;(ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mockClear()
  mainState.clear()
  Kis.inquireFill.mockReset()
  Backend.getTrades.mockReset()
  Backend.sendCallback.mockReset()
  Backend.sendCallback.mockResolvedValue(undefined)
  registerKisHandlers()
})

describe('TRADES_RECONCILE_PENDING', () => {
  it('체결이 확인되면 EXECUTED 콜백을 보낸다', async () => {
    Backend.getTrades.mockResolvedValue({ content: [PENDING_WMT] })
    Kis.inquireFill.mockResolvedValue({ executedQty: 1, avgPrice: 107.47 })

    const res = await handler()({})

    expect(Kis.inquireFill).toHaveBeenCalledWith('WMT', '0000044600')
    expect(Backend.sendCallback).toHaveBeenCalledWith('10', {
      status: 'EXECUTED',
      broker_order_id: '0000044600',
      executed_price: 107.47,
      executed_qty: 1,
      error_message: null,
    })
    expect(res).toEqual({ checked: 1, reconciled: 1, failed: 0 })
  })

  it('부분 체결이면 확정하지 않고, 남은 수량까지 체결된 뒤 전체 수량으로 확정한다', async () => {
    // MSFT 15주가 3주 → 12주로 나눠 체결됐는데 첫 3주로 확정돼 거래 내역에 3주로 남았던 경우.
    const pendingMsft = { id: 12, ticker: 'MSFT', status: 'PENDING', brokerOrderId: '0000031554', orderQty: 15 }
    Backend.getTrades.mockResolvedValue({ content: [pendingMsft] })
    Kis.inquireFill.mockResolvedValueOnce({ executedQty: 3, avgPrice: 520.71, remainingQty: 12 })

    const partial = await handler()({})
    expect(Backend.sendCallback).not.toHaveBeenCalled()
    expect(partial).toEqual({ checked: 1, reconciled: 0, failed: 0 })

    Kis.inquireFill.mockResolvedValueOnce({ executedQty: 15, avgPrice: 520.67, remainingQty: 0 })
    const done = await handler()({})
    expect(Backend.sendCallback).toHaveBeenCalledWith('12', {
      status: 'EXECUTED',
      broker_order_id: '0000031554',
      executed_price: 520.67,
      executed_qty: 15,
      error_message: null,
    })
    expect(done).toEqual({ checked: 1, reconciled: 1, failed: 0 })
  })

  it('부분 체결이 장이 끝날 만큼 오래 남아 있으면 체결된 수량으로 확정한다', async () => {
    // 그대로 두면 TTL 만료(EXPIRED)로 이미 체결된 3주까지 기록에서 사라진다.
    const nineHoursAgo = new Date(Date.now() - 9 * 3600_000).toISOString().replace('Z', '')
    Backend.getTrades.mockResolvedValue({
      content: [{ id: 13, ticker: 'LLY', status: 'PENDING', brokerOrderId: '0000031571', orderQty: 5, createdAt: nineHoursAgo }],
    })
    Kis.inquireFill.mockResolvedValue({ executedQty: 3, avgPrice: 1429.26, remainingQty: 2 })

    const res = await handler()({})

    expect(Backend.sendCallback).toHaveBeenCalledWith('13', expect.objectContaining({ status: 'EXECUTED', executed_qty: 3 }))
    expect(res.reconciled).toBe(1)
  })

  it('아직 미체결(0)이면 아무 상태도 바꾸지 않는다', async () => {
    Backend.getTrades.mockResolvedValue({ content: [PENDING_WMT] })
    Kis.inquireFill.mockResolvedValue({ executedQty: 0, avgPrice: null })

    const res = await handler()({})

    expect(Backend.sendCallback).not.toHaveBeenCalled()
    expect(res).toEqual({ checked: 1, reconciled: 0, failed: 0 })
  })

  it('조회 실패(null)를 체결/실패로 단정하지 않는다', async () => {
    // "모른다" 를 확정하면 살아 있는 주문을 잘못 종결시킨다.
    Backend.getTrades.mockResolvedValue({ content: [PENDING_WMT] })
    Kis.inquireFill.mockResolvedValue(null)

    const res = await handler()({})

    expect(Backend.sendCallback).not.toHaveBeenCalled()
    expect(res.reconciled).toBe(0)
    expect(res.failed).toBe(0)
  })

  it('ODNO 가 없는 PENDING 은 건너뛴다 (조회할 키가 없다)', async () => {
    Backend.getTrades.mockResolvedValue({
      content: [{ id: 11, ticker: 'WMT', status: 'PENDING', brokerOrderId: null }],
    })

    const res = await handler()({})

    expect(Kis.inquireFill).not.toHaveBeenCalled()
    expect(res.checked).toBe(0)
  })

  it('PENDING 이 아닌 주문은 조회하지 않는다', async () => {
    Backend.getTrades.mockResolvedValue({
      content: [
        { id: 12, ticker: 'WMT', status: 'EXECUTED', brokerOrderId: 'A' },
        { id: 13, ticker: 'WMT', status: 'EXPIRED', brokerOrderId: 'B' },
      ],
    })

    const res = await handler()({})

    expect(Kis.inquireFill).not.toHaveBeenCalled()
    expect(res.checked).toBe(0)
  })

  it('한 건이 실패해도 나머지는 계속 처리한다', async () => {
    Backend.getTrades.mockResolvedValue({
      content: [
        { id: 20, ticker: 'AAA', status: 'PENDING', brokerOrderId: 'O1' },
        { id: 21, ticker: 'BBB', status: 'PENDING', brokerOrderId: 'O2' },
      ],
    })
    Kis.inquireFill
      .mockRejectedValueOnce(new Error('KIS 조회 오류'))
      .mockResolvedValueOnce({ executedQty: 2, avgPrice: 50 })

    const res = await handler()({})

    expect(res).toEqual({ checked: 2, reconciled: 1, failed: 1 })
    expect(Backend.sendCallback).toHaveBeenCalledTimes(1)
  })

  it('SELF_PAPER 계좌는 KIS 를 조회하지 않는다', async () => {
    mainState.setAccountType('SELF_PAPER')

    const res = await handler()({})

    expect(Backend.getTrades).not.toHaveBeenCalled()
    expect(Kis.inquireFill).not.toHaveBeenCalled()
    expect(res).toEqual({ checked: 0, reconciled: 0, failed: 0 })
  })

  it('동시 호출은 하나의 실행을 공유한다 (중복 KIS 조회 방지)', async () => {
    // 호출 경로가 셋(화면 진입, 새로고침, 체결통보 콜백)이고 서로를 모른다. 겹쳐 돌면
    // 같은 PENDING 을 중복 조회해 KIS 초당 호출 예산을 잠식한다.
    let releaseTrades: (v: unknown) => void = () => {}
    Backend.getTrades.mockReturnValue(
      new Promise((resolve) => {
        releaseTrades = resolve
      }),
    )
    Kis.inquireFill.mockResolvedValue({ executedQty: 1, avgPrice: 107.47 })

    const h = handler()
    const first = h({})
    const second = h({})
    releaseTrades({ content: [PENDING_WMT] })
    const [a, b] = await Promise.all([first, second])

    expect(Backend.getTrades).toHaveBeenCalledTimes(1)
    expect(Kis.inquireFill).toHaveBeenCalledTimes(1)
    expect(Backend.sendCallback).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('완료 후에는 다시 실행된다 (가드가 영구히 잠기지 않는다)', async () => {
    Backend.getTrades.mockResolvedValue({ content: [] })

    await handler()({})
    await handler()({})

    expect(Backend.getTrades).toHaveBeenCalledTimes(2)
  })

  it('실행이 예외로 끝나도 가드가 풀린다', async () => {
    Backend.getTrades.mockRejectedValueOnce(new Error('네트워크 오류'))
    await expect(handler()({})).rejects.toBeDefined()

    Backend.getTrades.mockResolvedValue({ content: [] })
    await expect(handler()({})).resolves.toEqual({ checked: 0, reconciled: 0, failed: 0 })
  })

  it('거래 내역이 비어도 안전하게 0 을 반환한다', async () => {
    Backend.getTrades.mockResolvedValue(null)

    const res = await handler()({})

    expect(res).toEqual({ checked: 0, reconciled: 0, failed: 0 })
  })
})
